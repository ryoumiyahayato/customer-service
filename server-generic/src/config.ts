import { loadEncryptionConfig, safeEncryptionSummary, type EncryptionConfig } from './encryptionConfig.js';

export type AbuseLimitConfig = {
  loginLimit: number;
  loginWindowSeconds: number;
  setupLimit: number;
  setupWindowSeconds: number;
  guestLimit: number;
  guestWindowSeconds: number;
  messageLimit: number;
  messageIpLimit: number;
  messageWindowSeconds: number;
  uploadLimit: number;
  uploadWindowSeconds: number;
};

export type GenericServerConfig = {
  appDomain: string;
  visitorRootDomain: string;
  databaseUrl: string;
  storageDriver: string;
  storagePath: string;
  sessionSecret: string;
  setupToken: string;
  adminSessionTtl: number;
  lifecycleCron: string;
  maxUploadSize: number;
  logLevel: string;
  appPort: number;
  staticDir: string;
  encryption: EncryptionConfig;
  abuse: AbuseLimitConfig;
};

function readEnv(env: NodeJS.ProcessEnv, key: string, fallback = '') {
  return env[key] ?? fallback;
}

function readNumber(env: NodeJS.ProcessEnv, key: string, fallback: number) {
  const raw = env[key];
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function readAbuseNumber(env: NodeJS.ProcessEnv, key: string, fallback: number) {
  const raw = env[key];
  if (!raw) return fallback;
  const value = Number(raw);
  if (Number.isInteger(value) && value > 0) return value;
  console.warn(`Invalid ${key}; using default abuse guard value.`);
  return fallback;
}

function loadAbuseConfig(env: NodeJS.ProcessEnv): AbuseLimitConfig {
  return {
    loginLimit: readAbuseNumber(env, 'ABUSE_LOGIN_LIMIT', 5),
    loginWindowSeconds: readAbuseNumber(env, 'ABUSE_LOGIN_WINDOW_SECONDS', 5 * 60),
    setupLimit: readAbuseNumber(env, 'ABUSE_SETUP_LIMIT', 5),
    setupWindowSeconds: readAbuseNumber(env, 'ABUSE_SETUP_WINDOW_SECONDS', 10 * 60),
    guestLimit: readAbuseNumber(env, 'ABUSE_GUEST_LIMIT', 30),
    guestWindowSeconds: readAbuseNumber(env, 'ABUSE_GUEST_WINDOW_SECONDS', 10 * 60),
    messageLimit: readAbuseNumber(env, 'ABUSE_MESSAGE_LIMIT', 60),
    messageIpLimit: readAbuseNumber(env, 'ABUSE_MESSAGE_IP_LIMIT', 180),
    messageWindowSeconds: readAbuseNumber(env, 'ABUSE_MESSAGE_WINDOW_SECONDS', 60),
    uploadLimit: readAbuseNumber(env, 'ABUSE_UPLOAD_LIMIT', 20),
    uploadWindowSeconds: readAbuseNumber(env, 'ABUSE_UPLOAD_WINDOW_SECONDS', 10 * 60),
  };
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): GenericServerConfig {
  return {
    appDomain: readEnv(env, 'APP_DOMAIN'),
    visitorRootDomain: readEnv(env, 'VISITOR_ROOT_DOMAIN'),
    databaseUrl: readEnv(env, 'DATABASE_URL'),
    storageDriver: readEnv(env, 'STORAGE_DRIVER', 'local'),
    storagePath: readEnv(env, 'STORAGE_PATH', '/app/storage'),
    sessionSecret: readEnv(env, 'SESSION_SECRET'),
    setupToken: readEnv(env, 'SETUP_TOKEN'),
    adminSessionTtl: readNumber(env, 'ADMIN_SESSION_TTL', 86400),
    lifecycleCron: readEnv(env, 'LIFECYCLE_CRON', '0 * * * *'),
    maxUploadSize: readNumber(env, 'MAX_UPLOAD_SIZE', 10485760),
    logLevel: readEnv(env, 'LOG_LEVEL', 'info'),
    appPort: readNumber(env, 'APP_PORT', 3000),
    staticDir: readEnv(env, 'STATIC_DIR', '/app/dist'),
    encryption: loadEncryptionConfig(env),
    abuse: loadAbuseConfig(env),
  };
}

export function safeConfigSummary(config: GenericServerConfig) {
  return {
    appDomainConfigured: Boolean(config.appDomain),
    visitorRootDomainConfigured: Boolean(config.visitorRootDomain),
    databaseConfigured: Boolean(config.databaseUrl),
    storageDriver: config.storageDriver,
    setupTokenConfigured: Boolean(config.setupToken),
    staticDir: config.staticDir,
    encryption: safeEncryptionSummary(config.encryption),
    abuseGuard: {
      loginWindowSeconds: config.abuse.loginWindowSeconds,
      setupWindowSeconds: config.abuse.setupWindowSeconds,
      guestWindowSeconds: config.abuse.guestWindowSeconds,
      messageWindowSeconds: config.abuse.messageWindowSeconds,
      uploadWindowSeconds: config.abuse.uploadWindowSeconds,
    },
  };
}
