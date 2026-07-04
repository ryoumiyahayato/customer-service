import { loadConfig } from '../dist/config.js';
import { generateSessionToken, hashPassword, hashSessionToken, verifyPassword } from '../dist/crypto.js';

const config = loadConfig({
  ...process.env,
  APP_PORT: process.env.APP_PORT || '3000',
  DATABASE_URL: '',
  SETUP_TOKEN: '',
});

if (!Number.isFinite(config.appPort) || config.appPort <= 0) {
  throw new Error('config smoke failed');
}

const password = 'local-smoke-password-only';
const passwordHash = await hashPassword(password);
const passwordOk = await verifyPassword(password, passwordHash);
const passwordRejected = await verifyPassword('local-smoke-password-wrong', passwordHash);

if (!passwordOk || passwordRejected) {
  throw new Error('password hash smoke failed');
}

const sessionToken = generateSessionToken();
const sessionHash = hashSessionToken(sessionToken);
if (!sessionToken || !sessionHash || sessionToken === sessionHash) {
  throw new Error('session hash smoke failed');
}

console.log('server-generic smoke passed: config, password hash, session hash');
