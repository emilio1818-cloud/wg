/**
 * Web Push primitives (zero dependencies): VAPID (RFC 8292) authorization and
 * `aes128gcm` payload encryption (RFC 8291 + RFC 8188). Knows nothing about
 * the app; see app.ts for when and what gets pushed.
 *
 * Key format: both VAPID keys are base64url without padding.
 *   publicKey  — the 65-byte uncompressed P-256 point (0x04 || X || Y); this is
 *                what browsers take as `applicationServerKey`.
 *   privateKey — the raw 32-byte private scalar (the `d` of the JWK).
 * This is the same format `npx web-push generate-vapid-keys` prints.
 */
import crypto from 'node:crypto';

export interface VapidKeys {
  publicKey: string;
  privateKey: string;
}

/** A browser push subscription as stored by the server. */
export interface PushTarget {
  endpoint: string;
  /** base64url, 65-byte uncompressed P-256 point of the user agent. */
  p256dh: string;
  /** base64url, 16-byte authentication secret. */
  auth: string;
}

export interface SendOptions {
  /** Seconds the push service keeps an undelivered message (default 86400). */
  ttl?: number;
  urgency?: 'very-low' | 'low' | 'normal' | 'high';
  /** Replaces a pending undelivered message with the same topic (≤ 32 url-safe chars). */
  topic?: string;
  /** Network timeout in ms (default 10000). */
  timeoutMs?: number;
}

export interface SendResult {
  /** HTTP status of the push service, 0 on network errors/timeouts. */
  status: number;
  /** The subscription is expired or unsubscribed (404/410) and should be deleted. */
  gone: boolean;
}

const RECORD_SIZE = 4096;
const SALT_BYTES = 16;
const TAG_BYTES = 16;
const PUBLIC_KEY_BYTES = 65;
const HEADER_BYTES = SALT_BYTES + 4 + 1 + PUBLIC_KEY_BYTES;
/** Push services accept at most 4096 bytes of encrypted body. */
export const MAX_PAYLOAD_BYTES = RECORD_SIZE - HEADER_BYTES - TAG_BYTES - 1;
const JWT_LIFETIME_S = 12 * 60 * 60;

const b64url = (buf: Uint8Array) => Buffer.from(buf).toString('base64url');

/** Decodes base64url (padding optional); returns null for anything else. */
export function decodeBase64Url(value: unknown): Buffer | null {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]*={0,2}$/.test(value)) return null;
  return Buffer.from(value, 'base64url');
}

/** Left-pads a big-endian integer to `length` bytes (JWK coordinates must be fixed-size). */
function fixed(buf: Buffer, length: number): Buffer {
  if (buf.length === length) return buf;
  if (buf.length > length) return buf.subarray(buf.length - length);
  return Buffer.concat([Buffer.alloc(length - buf.length), buf]);
}

/* ------------------------------------ VAPID ----------------------------------- */

export function generateVapidKeys(): VapidKeys {
  const { privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const jwk = privateKey.export({ format: 'jwk' });
  const x = fixed(Buffer.from(jwk.x!, 'base64url'), 32);
  const y = fixed(Buffer.from(jwk.y!, 'base64url'), 32);
  const d = fixed(Buffer.from(jwk.d!, 'base64url'), 32);
  return { publicKey: b64url(Buffer.concat([Buffer.from([4]), x, y])), privateKey: b64url(d) };
}

const keyObjects = new Map<string, crypto.KeyObject>();

/**
 * Parses and checks a VAPID key pair (lengths, curve point, and that the public
 * key belongs to the private key). Throws a descriptive Error otherwise.
 */
export function vapidPrivateKeyObject(keys: VapidKeys): crypto.KeyObject {
  const cacheKey = `${keys.publicKey}.${keys.privateKey}`;
  const cached = keyObjects.get(cacheKey);
  if (cached) return cached;
  const pub = decodeBase64Url(keys.publicKey);
  const priv = decodeBase64Url(keys.privateKey);
  if (!pub || pub.length !== PUBLIC_KEY_BYTES || pub[0] !== 4) {
    throw new Error('VAPID public key must be a base64url 65-byte uncompressed P-256 point');
  }
  if (!priv || priv.length !== 32) throw new Error('VAPID private key must be a base64url 32-byte P-256 scalar');
  const ecdh = crypto.createECDH('prime256v1');
  try {
    ecdh.setPrivateKey(priv);
  } catch {
    throw new Error('VAPID private key is not a valid P-256 scalar');
  }
  if (!ecdh.getPublicKey().equals(pub)) throw new Error('VAPID public key does not match the private key');
  const key = crypto.createPrivateKey({
    format: 'jwk',
    key: { kty: 'EC', crv: 'P-256', x: b64url(pub.subarray(1, 33)), y: b64url(pub.subarray(33)), d: b64url(priv) },
  });
  keyObjects.set(cacheKey, key);
  return key;
}

/**
 * `Authorization` header value for a push to `endpoint`: an ES256 JWT with
 * `aud` = the endpoint's origin, `exp` = now + 12 h and `sub` = `subject`
 * (a `mailto:` or `https:` contact), plus the public key.
 */
export function vapidAuthorization(endpoint: string, keys: VapidKeys, subject: string, now = Date.now()): string {
  const header = b64url(Buffer.from(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = b64url(
    Buffer.from(
      JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(now / 1000) + JWT_LIFETIME_S, sub: subject }),
    ),
  );
  const unsigned = `${header}.${claims}`;
  const signature = crypto.sign('sha256', Buffer.from(unsigned), {
    key: vapidPrivateKeyObject(keys),
    dsaEncoding: 'ieee-p1363',
  });
  return `vapid t=${unsigned}.${b64url(signature)}, k=${keys.publicKey}`;
}

/* --------------------------------- encryption --------------------------------- */

const hkdf = (ikm: Uint8Array, salt: Uint8Array, info: Uint8Array, length: number) =>
  Buffer.from(crypto.hkdfSync('sha256', ikm, salt, info, length));

/** Checks a subscription's keys; returns the decoded buffers or null. */
export function decodeSubscriptionKeys(p256dh: unknown, auth: unknown): { uaPublic: Buffer; authSecret: Buffer } | null {
  const uaPublic = decodeBase64Url(p256dh);
  const authSecret = decodeBase64Url(auth);
  if (!uaPublic || uaPublic.length !== PUBLIC_KEY_BYTES || uaPublic[0] !== 4) return null;
  if (!authSecret || authSecret.length !== 16) return null;
  try {
    // Throws unless the bytes are a point on the curve.
    crypto.ECDH.convertKey(uaPublic, 'prime256v1');
  } catch {
    return null;
  }
  return { uaPublic, authSecret };
}

/**
 * Encrypts `payload` for one subscription with the `aes128gcm` content coding:
 * an ephemeral ECDH key, a random salt and a single record. Returns the
 * complete request body (header || ciphertext). Throws for invalid keys or a
 * payload over MAX_PAYLOAD_BYTES.
 */
export function encryptPayload(payload: Buffer, p256dh: string, auth: string): Buffer {
  const keys = decodeSubscriptionKeys(p256dh, auth);
  if (!keys) throw new Error('Invalid subscription keys');
  if (payload.length > MAX_PAYLOAD_BYTES) throw new RangeError(`Push payload exceeds ${MAX_PAYLOAD_BYTES} bytes`);

  const ecdh = crypto.createECDH('prime256v1');
  const asPublic = ecdh.generateKeys();
  const ecdhSecret = ecdh.computeSecret(keys.uaPublic);

  // RFC 8291 §3.4: IKM = HKDF(auth_secret, ecdh_secret, "WebPush: info\0" || ua_public || as_public, 32)
  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), keys.uaPublic, asPublic]);
  const ikm = hkdf(ecdhSecret, keys.authSecret, keyInfo, 32);

  // RFC 8188 §2.2/2.3: content-encryption key and nonce from a random salt.
  const salt = crypto.randomBytes(SALT_BYTES);
  const cek = hkdf(ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16);
  const nonce = hkdf(ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12);

  const cipher = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  // 0x02 marks the last (and only) record; no further padding.
  const ciphertext = Buffer.concat([cipher.update(payload), cipher.update(Buffer.from([2])), cipher.final(), cipher.getAuthTag()]);

  const header = Buffer.alloc(HEADER_BYTES);
  salt.copy(header, 0);
  header.writeUInt32BE(RECORD_SIZE, SALT_BYTES);
  header.writeUInt8(PUBLIC_KEY_BYTES, SALT_BYTES + 4);
  asPublic.copy(header, SALT_BYTES + 5);
  return Buffer.concat([header, ciphertext]);
}

/* ----------------------------------- sending ---------------------------------- */

/** Topic header value: url-safe base64 alphabet only, at most 32 characters. */
export function sanitizeTopic(topic: string): string {
  return topic.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32);
}

/**
 * Encrypts and POSTs one message to a push service. Never throws: network
 * errors, timeouts and encryption failures report status 0.
 */
export async function sendPush(
  sub: PushTarget,
  payloadJson: string,
  keys: VapidKeys,
  subject: string,
  opts: SendOptions = {},
): Promise<SendResult> {
  let body: Buffer;
  let authorization: string;
  try {
    body = encryptPayload(Buffer.from(payloadJson, 'utf8'), sub.p256dh, sub.auth);
    authorization = vapidAuthorization(sub.endpoint, keys, subject);
  } catch {
    return { status: 0, gone: false };
  }
  const headers: Record<string, string> = {
    TTL: String(Math.max(0, Math.floor(opts.ttl ?? 86_400))),
    Urgency: opts.urgency ?? 'normal',
    'Content-Encoding': 'aes128gcm',
    'Content-Type': 'application/octet-stream',
    Authorization: authorization,
  };
  const topic = opts.topic ? sanitizeTopic(opts.topic) : '';
  if (topic) headers.Topic = topic;
  try {
    const res = await fetch(sub.endpoint, {
      method: 'POST',
      headers,
      body: new Uint8Array(body),
      redirect: 'manual',
      signal: AbortSignal.timeout(opts.timeoutMs ?? 10_000),
    });
    // Drain the body so the connection can be reused.
    await res.arrayBuffer().catch(() => undefined);
    return { status: res.status, gone: res.status === 404 || res.status === 410 };
  } catch {
    return { status: 0, gone: false };
  }
}
