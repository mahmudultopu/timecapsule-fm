import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

export interface SignedUrl {
  url: string;
  expiresAt: Date;
}

/**
 * Object storage as the API sees it. Two private buckets:
 *  - media:      processed audio and peaks, read via short-lived signed GETs
 *  - quarantine: raw uploads, written via signed PUTs, read only by the worker
 */
export interface Storage {
  /** Short-lived GET URL for a private media object. */
  signGet(key: string, opts: { ttlSeconds: number; contentType: string }): Promise<SignedUrl>;
  /** Short-lived PUT URL into quarantine. Length and type are part of the signature. */
  signUpload(key: string, opts: { ttlSeconds: number; contentType: string; contentLength: number }): Promise<SignedUrl>;
  /** Size of an uploaded quarantine object, or null if it doesn't exist. */
  quarantineSize(key: string): Promise<number | null>;
}

export interface S3StorageOptions {
  endpoint: string;
  publicEndpoint?: string | undefined;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  mediaBucket: string;
  quarantineBucket: string;
  forcePathStyle: boolean;
}

export class S3Storage implements Storage {
  /** Signs against the endpoint browsers will actually use (the host is part of the signature). */
  private readonly signer: S3Client;
  /** Talks to storage over the internal network. */
  private readonly client: S3Client;

  constructor(private readonly opts: S3StorageOptions) {
    const base = {
      region: opts.region,
      forcePathStyle: opts.forcePathStyle,
      credentials: { accessKeyId: opts.accessKeyId, secretAccessKey: opts.secretAccessKey },
      // Otherwise newer SDKs embed a checksum of the (empty) body in signed
      // PUT URLs, which storage then rejects when the real file arrives.
      requestChecksumCalculation: 'WHEN_REQUIRED' as const,
    };
    this.signer = new S3Client({ ...base, endpoint: opts.publicEndpoint ?? opts.endpoint });
    this.client = new S3Client({ ...base, endpoint: opts.endpoint });
  }

  async signGet(key: string, { ttlSeconds, contentType }: { ttlSeconds: number; contentType: string }) {
    const command = new GetObjectCommand({
      Bucket: this.opts.mediaBucket,
      Key: key,
      ResponseContentType: contentType,
      ResponseContentDisposition: 'inline',
      ResponseCacheControl: 'private, max-age=0, no-transform',
    });
    const url = await getSignedUrl(this.signer, command, { expiresIn: ttlSeconds });
    return { url, expiresAt: new Date(Date.now() + ttlSeconds * 1000) };
  }

  async signUpload(
    key: string,
    { ttlSeconds, contentType, contentLength }: { ttlSeconds: number; contentType: string; contentLength: number },
  ) {
    const command = new PutObjectCommand({
      Bucket: this.opts.quarantineBucket,
      Key: key,
      ContentType: contentType,
      ContentLength: contentLength,
    });
    // Signing content-length means the browser can't upload more than it declared.
    const url = await getSignedUrl(this.signer, command, {
      expiresIn: ttlSeconds,
      signableHeaders: new Set(['content-type', 'content-length']),
    });
    return { url, expiresAt: new Date(Date.now() + ttlSeconds * 1000) };
  }

  async quarantineSize(key: string): Promise<number | null> {
    try {
      const head = await this.client.send(new HeadObjectCommand({ Bucket: this.opts.quarantineBucket, Key: key }));
      return head.ContentLength ?? null;
    } catch {
      return null;
    }
  }
}
