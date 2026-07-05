export type EncryptionConfig = {
  enabled: boolean;
  key: Buffer | null;
  keyVersion: string;
};

function readBoolean(value: string | undefined): boolean {
  return value === '1' || value?.toLowerCase() === 'true';
}

function parseEncryptionKey(raw: string): Buffer {
  const trimmed = raw.trim();
  if (!trimmed) throw new Error('ENCRYPTION_KEY is required when encryption is enabled.');

  if (/^[a-f0-9]{64}$/i.test(trimmed)) {
    return Buffer.from(trimmed, 'hex');
  }

  const base64 = Buffer.from(trimmed, 'base64');
  if (base64.length === 32 && base64.toString('base64').replace(/=+$/, '') === trimmed.replace(/=+$/, '')) {
    return base64;
  }

  const utf8 = Buffer.from(trimmed, 'utf8');
  if (utf8.length === 32) return utf8;

  throw new Error('ENCRYPTION_KEY must decode to exactly 32 bytes.');
}

export function loadEncryptionConfig(env: NodeJS.ProcessEnv = process.env): EncryptionConfig {
  const enabled = readBoolean(env.ENCRYPTION_ENABLED);
  const keyVersion = env.ENCRYPTION_KEY_VERSION?.trim() || 'v1';

  if (!enabled) {
    return {
      enabled: false,
      key: null,
      keyVersion,
    };
  }

  return {
    enabled: true,
    key: parseEncryptionKey(env.ENCRYPTION_KEY || ''),
    keyVersion,
  };
}

export function safeEncryptionSummary(config: EncryptionConfig) {
  return {
    enabled: config.enabled,
    keyConfigured: Boolean(config.key),
    keyVersion: config.keyVersion,
  };
}
