import { loadEncryptionConfig, safeEncryptionSummary, type EncryptionConfig } from './encryptionConfig.js';

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
  };
}
