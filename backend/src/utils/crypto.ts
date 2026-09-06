import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'node:crypto';
import { encryptionKey } from '../config/env.js';

/**
 * Authenticated encryption for secrets held at rest (Slack tokens, sender
 * passwords).
 *
 * AES-256-GCM: the tag makes tampering detectable, so a modified ciphertext
 * fails to decrypt rather than yielding garbage. Values are stored as
 * `v1:iv:tag:ciphertext`, all base64 — the version prefix leaves room to
 * rotate the scheme later without guessing at old rows.
 */

const VERSION = 'v1';
const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;

/** Accepts any key material and derives a stable 32-byte key from it. */
function key(): Buffer {
  return createHash('sha256').update(encryptionKey()).digest();
}

export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [VERSION, iv.toString('base64'), tag.toString('base64'), ciphertext.toString('base64')].join(
    ':',
  );
}

export function decryptSecret(payload: string): string {
  const [version, ivB64, tagB64, dataB64] = payload.split(':');

  if (version !== VERSION || !ivB64 || !tagB64 || !dataB64) {
    throw new Error('Encrypted value is malformed or uses an unknown version');
  }

  const decipher = createDecipheriv(ALGORITHM, key(), Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));

  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

/** Safe for logs: never reveals enough to be useful. */
export function maskSecret(value: string | null | undefined): string {
  if (!value) return '(none)';
  return value.length <= 8 ? '***' : `${value.slice(0, 4)}…${value.slice(-2)}`;
}
