import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { Transform, type Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { DeleteObjectsCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { Rejection } from './media.js';

export interface WorkerStorage {
  /** Streams a quarantined upload to disk, refusing anything over `maxBytes`. */
  downloadQuarantine(key: string, dest: string, maxBytes: number): Promise<{ bytes: number; sha256: string; head: Uint8Array }>;
  putMedia(key: string, body: Buffer | string, contentType: string): Promise<void>;
  putMediaFile(key: string, path: string, contentType: string): Promise<void>;
  deleteQuarantine(keys: string[]): Promise<void>;
  deleteMedia(keys: string[]): Promise<void>;
}

/** Counts bytes and hashes them as they stream past; aborts past the limit. */
function meter(maxBytes: number) {
  const hash = createHash('sha256');
  let bytes = 0;
  let head = Buffer.alloc(0);
  const stream = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      bytes += chunk.length;
      if (bytes > maxBytes) return cb(new Rejection('too_large', 'The file is larger than allowed'));
      if (head.length < 16) head = Buffer.concat([head, chunk.subarray(0, 16 - head.length)]);
      hash.update(chunk);
      cb(null, chunk);
    },
  });
  return { stream, result: () => ({ bytes, sha256: hash.digest('hex'), head: new Uint8Array(head) }) };
}

export class S3WorkerStorage implements WorkerStorage {
  private readonly s3: S3Client;

  constructor(
    private readonly opts: {
      endpoint: string;
      region: string;
      accessKeyId: string;
      secretAccessKey: string;
      forcePathStyle: boolean;
      mediaBucket: string;
      quarantineBucket: string;
    },
  ) {
    this.s3 = new S3Client({
      endpoint: opts.endpoint,
      region: opts.region,
      forcePathStyle: opts.forcePathStyle,
      credentials: { accessKeyId: opts.accessKeyId, secretAccessKey: opts.secretAccessKey },
      // Plain uploads; some S3-compatible stores reject the newer streaming checksums.
      requestChecksumCalculation: 'WHEN_REQUIRED',
    });
  }

  async downloadQuarantine(key: string, dest: string, maxBytes: number) {
    const res = await this.s3.send(new GetObjectCommand({ Bucket: this.opts.quarantineBucket, Key: key }));
    if (!res.Body) throw new Rejection('missing_object');
    const m = meter(maxBytes);
    await pipeline(res.Body as Readable, m.stream, createWriteStream(dest, { mode: 0o600 }));
    return m.result();
  }

  async putMedia(key: string, body: Buffer | string, contentType: string) {
    await this.s3.send(new PutObjectCommand({ Bucket: this.opts.mediaBucket, Key: key, Body: body, ContentType: contentType }));
  }

  async putMediaFile(key: string, path: string, contentType: string) {
    const { size } = await stat(path);
    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.opts.mediaBucket,
        Key: key,
        Body: createReadStream(path),
        ContentLength: size,
        ContentType: contentType,
      }),
    );
  }

  async deleteQuarantine(keys: string[]) {
    await this.delete(this.opts.quarantineBucket, keys);
  }

  async deleteMedia(keys: string[]) {
    await this.delete(this.opts.mediaBucket, keys);
  }

  private async delete(bucket: string, keys: string[]) {
    if (keys.length === 0) return;
    await this.s3.send(new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: keys.map((Key) => ({ Key })) } }));
  }
}
