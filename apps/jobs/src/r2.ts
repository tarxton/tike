import { AwsClient } from 'aws4fetch';

/**
 * Cloudflare R2, over its S3-compatible API.
 *
 * `aws4fetch` rather than the AWS SDK: this needs four verbs and the SDK is twenty
 * megabytes of client for them. R2 speaks S3 well enough that request signing is the only
 * part that matters.
 */

export interface R2Config {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  /** Where the objects are readable from — an r2.dev address or a custom domain. */
  publicBaseUrl: string;
}

export class R2NotConfiguredError extends Error {}

/**
 * Reads the R2 settings, or explains precisely which one is missing.
 *
 * Named rather than counted, because "R2 is not configured" sends someone to re-read four
 * variables when one of them is the problem.
 */
export function readR2Config(): R2Config {
  const vars = {
    accountId: process.env.R2_ACCOUNT_ID,
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    bucket: process.env.R2_BUCKET,
    publicBaseUrl: process.env.R2_PUBLIC_BASE_URL,
  };
  const missing = Object.entries(vars)
    .filter(([, v]) => !v)
    .map(([k]) => `R2_${k.replace(/[A-Z]/g, (c) => '_' + c).toUpperCase()}`.replace('R2__', 'R2_'));

  if (missing.length > 0) {
    throw new R2NotConfiguredError(
      `R2 is not configured: ${missing.join(', ')} missing. Create a bucket and an API ` +
        `token at dash.cloudflare.com > R2, then put the values in .env.local.`,
    );
  }
  return vars as R2Config;
}

export function r2Client(config: R2Config): AwsClient {
  return new AwsClient({
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    service: 's3',
    region: 'auto',
  });
}

/** Stores one object and returns the URL it will be served from. */
export async function putObject(
  client: AwsClient,
  config: R2Config,
  key: string,
  body: Uint8Array,
  contentType: string,
): Promise<string> {
  const endpoint = `https://${config.accountId}.r2.cloudflarestorage.com/${config.bucket}/${key}`;
  const res = await client.fetch(endpoint, {
    method: 'PUT',
    body,
    headers: {
      'content-type': contentType,
      // A year: the key contains a hash of the source URL, so a changed picture gets a
      // different key rather than a stale cache.
      'cache-control': 'public, max-age=31536000, immutable',
    },
  });
  if (!res.ok) {
    throw new Error(`R2 PUT ${key} failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
  }
  return `${config.publicBaseUrl.replace(/\/$/, '')}/${key}`;
}

/** One page of keys under a prefix. R2 caps a listing at 1000, as S3 does. */
export async function listObjects(
  client: AwsClient,
  config: R2Config,
  prefix: string,
  token?: string,
): Promise<{ keys: string[]; next?: string }> {
  const url = new URL(`https://${config.accountId}.r2.cloudflarestorage.com/${config.bucket}`);
  url.searchParams.set('list-type', '2');
  url.searchParams.set('prefix', prefix);
  if (token) url.searchParams.set('continuation-token', token);

  const res = await client.fetch(url.toString());
  if (!res.ok) {
    throw new Error(`R2 LIST ${prefix} failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
  }
  const xml = await res.text();
  const keys = [...xml.matchAll(/<Key>([^<]+)<\/Key>/g)].map((m) => decodeXml(m[1]!));
  const next = /<IsTruncated>true<\/IsTruncated>/.test(xml)
    ? decodeXml(/<NextContinuationToken>([^<]+)<\/NextContinuationToken>/.exec(xml)?.[1] ?? '')
    : undefined;
  return { keys, next: next || undefined };
}

function decodeXml(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

/** Deletes up to 1000 keys in one request, which is the S3 batch limit R2 honours. */
export async function deleteObjects(
  client: AwsClient,
  config: R2Config,
  keys: string[],
): Promise<void> {
  if (keys.length === 0) return;
  const body =
    `<Delete>${keys.map((k) => `<Object><Key>${escapeXml(k)}</Key></Object>`).join('')}` +
    `<Quiet>true</Quiet></Delete>`;
  // R2 requires the payload hash for this verb, and aws4fetch computes it when the body
  // is a string it can read twice.
  const url = `https://${config.accountId}.r2.cloudflarestorage.com/${config.bucket}?delete`;
  const res = await client.fetch(url, {
    method: 'POST',
    body,
    headers: { 'content-type': 'application/xml' },
  });
  if (!res.ok) {
    throw new Error(`R2 DELETE failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
  }
}

function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, (c) =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&apos;',
  );
}
