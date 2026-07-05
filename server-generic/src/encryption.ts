import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type { EncryptionConfig } from './encryptionConfig.js';

export const ENCRYPTION_ALGORITHM = 'AES-256-GCM';

export type EncryptedText = {
  ciphertext: string;
  iv: string;
  tag: string;
  algorithm: string;
  keyVersion: string;
};

function requireEncryptionKey(config: EncryptionConfig): Buffer {
  if (!config.enabled || !config.key) throw new Error('encryption_not_configured');
  return config.key;
}

export function encryptText(plaintext: string, config: EncryptionConfig): EncryptedText {
  const key = requireEncryptionKey(config);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    ciphertext: ciphertext.toString('base64'),
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    algorithm: ENCRYPTION_ALGORITHM,
    keyVersion: config.keyVersion,
  };
}

export function decryptText(payload: EncryptedText, config: EncryptionConfig): string {
  try {
    const key = requireEncryptionKey(config);
    if (payload.algorithm !== ENCRYPTION_ALGORITHM) throw new Error('unsupported_algorithm');

    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(payload.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(payload.tag, 'base64'));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(payload.ciphertext, 'base64')),
      decipher.final(),
    ]);
    return plaintext.toString('utf8');
  } catch {
    throw new Error('decryption_failed');
  }
}

export function maybeEncryptText(value: string, config: EncryptionConfig): EncryptedText | null {
  if (!config.enabled) return null;
  return encryptText(value, config);
}

export function maybeDecryptText(payload: EncryptedText | null, fallback: string | null, config: EncryptionConfig): string | null {
  if (!payload?.ciphertext) return fallback;
  return decryptText(payload, config);
}
