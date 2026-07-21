/**
 * AES-256-GCM encryption utility for sensitive tenant credentials.
 *
 * Usage:
 *   encrypt(plaintext)  → Base64 bundle: "<iv>:<authTag>:<ciphertext>"
 *   decrypt(bundle)     → original plaintext string
 *
 * Key: ECF_ENCRYPTION_KEY env var — must be a 32-byte hex string (64 hex chars).
 *
 * Security: The output bundle MUST never be logged or returned to the client.
 */

import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96-bit IV recommended for GCM
const AUTH_TAG_LENGTH = 16;
const SEPARATOR = ':';

function getKey(): Buffer {
  const hex = process.env.ECF_ENCRYPTION_KEY;
  if (!hex || hex.length !== 64) {
    throw new Error(
      'ECF_ENCRYPTION_KEY must be a 64-character hex string (32 bytes). ' +
      'Generate with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"'
    );
  }
  return Buffer.from(hex, 'hex');
}

/**
 * Encrypts a plaintext string using AES-256-GCM.
 * Returns a Base64-encoded bundle in the format: iv:authTag:ciphertext
 */
export function encrypt(plaintext: string): string {
  const key = getKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });

  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return [
    iv.toString('base64'),
    authTag.toString('base64'),
    encrypted.toString('base64'),
  ].join(SEPARATOR);
}

/**
 * Decrypts a bundle produced by `encrypt`.
 */
export function decrypt(bundle: string): string {
  const key = getKey();
  const parts = bundle.split(SEPARATOR);
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted bundle format');
  }

  const iv = Buffer.from(parts[0], 'base64');
  const authTag = Buffer.from(parts[1], 'base64');
  const ciphertext = Buffer.from(parts[2], 'base64');

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  decipher.setAuthTag(authTag);

  return decipher.update(ciphertext) + decipher.final('utf8');
}
