import { createECDH, createDecipheriv, hkdfSync, randomBytes, type ECDH } from 'node:crypto';

// A stand-in for a browser and its push service (WP-40), for tests: a browser's subscription keys,
// a push service that records what it is sent and answers with a chosen status, and the browser's
// side of RFC 8291, to read what a reminder said on the wire. Node only; no imports from the app.

export interface PushMessage {
  endpoint: string;
  method: string;
  headers: Record<string, string>;
  body: Buffer | null;
}

/** A browser's subscription keys: its P-256 key pair and auth secret (base64url, as browsers give). */
export function browserKeys(): { ecdh: ECDH; p256dh: string; auth: string; authBytes: Buffer } {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  const authBytes = randomBytes(16);
  return {
    ecdh,
    p256dh: ecdh.getPublicKey().toString('base64url'),
    auth: authBytes.toString('base64url'),
    authBytes,
  };
}

/** A throwaway VAPID key pair (base64url): a P-256 public key of 65 bytes, private key of 32. */
export function vapidKeys(): { publicKey: string; privateKey: string } {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  const key = ecdh.getPrivateKey();
  return {
    publicKey: ecdh.getPublicKey().toString('base64url'),
    privateKey: Buffer.concat([Buffer.alloc(32 - key.length), key]).toString('base64url'),
  };
}

/** A push service: records each message, and answers each endpoint's status (201 by default). */
export function mockPushService(statusFor: (endpoint: string) => number = () => 201) {
  const received: PushMessage[] = [];
  return {
    received,
    transport: async (m: PushMessage): Promise<number> => {
      received.push(m);
      return statusFor(m.endpoint);
    },
  };
}

const hkdf = (salt: Buffer, ikm: Buffer, info: Buffer, length: number) =>
  Buffer.from(hkdfSync('sha256', ikm, salt, info, length));

/** The browser's side of RFC 8291 (aes128gcm, one record): the plaintext a push message carries. */
export function decryptPush(body: Buffer, ecdh: ECDH, authSecret: Buffer): string {
  const salt = body.subarray(0, 16);
  const idLength = body.readUInt8(20);
  const serverKey = body.subarray(21, 21 + idLength);
  const ciphertext = body.subarray(21 + idLength);
  const shared = ecdh.computeSecret(serverKey);
  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), ecdh.getPublicKey(), serverKey]);
  const ikm = hkdf(authSecret, shared, keyInfo, 32);
  const cek = hkdf(salt, ikm, Buffer.from('Content-Encoding: aes128gcm\0'), 16);
  const nonce = hkdf(salt, ikm, Buffer.from('Content-Encoding: nonce\0'), 12);
  const decipher = createDecipheriv('aes-128-gcm', cek, nonce);
  decipher.setAuthTag(ciphertext.subarray(ciphertext.length - 16));
  const padded = Buffer.concat([
    decipher.update(ciphertext.subarray(0, ciphertext.length - 16)),
    decipher.final(),
  ]);
  // The last record ends with 0x02 and any padding zeros after it.
  let end = padded.length - 1;
  while (end > 0 && padded[end] === 0) end--;
  return padded.subarray(0, end).toString('utf8');
}
