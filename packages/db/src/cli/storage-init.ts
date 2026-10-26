// Creates the two private buckets and their CORS rules (idempotent).
//   S3_ENDPOINT=... S3_BUCKET_MEDIA=... S3_BUCKET_QUARANTINE=... CORS_ORIGIN=https://timecapsule.fm \
//     pnpm --filter @timecapsule/db storage:init
//
// Both buckets stay private; CORS only lets the app's own origin use the
// signed URLs the API hands out:
//  - media:      GET/HEAD, because the player streams through Web Audio
//                (crossorigin="anonymous") with range requests
//  - quarantine: PUT, because browsers upload straight to storage
import {
  CreateBucketCommand,
  HeadBucketCommand,
  PutBucketCorsCommand,
  PutPublicAccessBlockCommand,
  S3Client,
  type CORSRule,
} from '@aws-sdk/client-s3';

const env = (k: string) => {
  const v = process.env[k];
  if (!v) throw new Error(`${k} is required`);
  return v;
};

const s3 = new S3Client({
  endpoint: env('S3_ENDPOINT'),
  region: process.env.S3_REGION ?? 'auto',
  forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
  credentials: { accessKeyId: env('S3_ACCESS_KEY_ID'), secretAccessKey: env('S3_SECRET_ACCESS_KEY') },
});
const origin = env('CORS_ORIGIN');

/** Storage may still be starting (e.g. in docker compose); retry for a while. */
async function withRetry<T>(fn: () => Promise<T>, attempts = 30): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (err) {
      if (i >= attempts) throw err;
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}

async function ensureBucket(Bucket: string, rule: CORSRule) {
  const exists = await withRetry(() =>
    s3.send(new HeadBucketCommand({ Bucket })).then(
      () => true,
      (err: { $metadata?: { httpStatusCode?: number } }) => {
        // 404 means "doesn't exist yet"; anything else (connection refused…) is retried.
        if (err.$metadata?.httpStatusCode === 404) return false;
        throw err;
      },
    ),
  );
  if (!exists) {
    await withRetry(() => s3.send(new CreateBucketCommand({ Bucket })));
    console.log(`created bucket ${Bucket}`);
  }
  // R2 and AWS support bucket CORS; some local S3 stand-ins allow all origins
  // and don't implement this call, which is fine for development.
  await s3
    .send(new PutBucketCorsCommand({ Bucket, CORSConfiguration: { CORSRules: [rule] } }))
    .catch((err: Error) => console.warn(`${Bucket}: could not set CORS (${err.name}); check the store's CORS settings`));
  // Not every S3-compatible store implements this; buckets are private by default regardless.
  await s3
    .send(
      new PutPublicAccessBlockCommand({
        Bucket,
        PublicAccessBlockConfiguration: {
          BlockPublicAcls: true,
          BlockPublicPolicy: true,
          IgnorePublicAcls: true,
          RestrictPublicBuckets: true,
        },
      }),
    )
    .catch(() => console.warn(`${Bucket}: public access block not supported; relying on private default`));
  console.log(`bucket ${Bucket} ready`);
}

await ensureBucket(env('S3_BUCKET_MEDIA'), {
  AllowedOrigins: [origin],
  AllowedMethods: ['GET', 'HEAD'],
  AllowedHeaders: ['Range'],
  ExposeHeaders: ['Content-Length', 'Content-Range', 'Accept-Ranges'],
  MaxAgeSeconds: 3600,
});

await ensureBucket(env('S3_BUCKET_QUARANTINE'), {
  AllowedOrigins: [origin],
  AllowedMethods: ['PUT'],
  AllowedHeaders: ['Content-Type'],
  ExposeHeaders: ['ETag'],
  MaxAgeSeconds: 3600,
});
