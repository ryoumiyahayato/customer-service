const crypto = require('crypto');
const postgres = require('postgres');

const [username, password, role = 'OPERATOR'] = process.argv.slice(2);
if (!username || !password) throw new Error('Usage: npm run create-admin -- username password [SUPER_ADMIN|OPERATOR]');
if (!['SUPER_ADMIN', 'OPERATOR'].includes(role)) throw new Error('Role must be SUPER_ADMIN or OPERATOR');
const connectionString = process.env.POSTGRES_URL || process.env.DATABASE_URL;
if (!connectionString) throw new Error('POSTGRES_URL or DATABASE_URL is required.');
const sql = postgres(connectionString, { ssl: 'require', max: 1 });
const now = () => new Date().toISOString();
const id = (prefix) => `${prefix}_${crypto.randomBytes(12).toString('hex')}`;
function hashPassword(value) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(value, salt, 64).toString('hex');
  return `scrypt:${salt}:${hash}`;
}

async function main() {
  const t = now();
  await sql`INSERT INTO admins VALUES (${id('admin')},${username},${hashPassword(password)},${role},0,${t},${t})`;
  console.log('Admin created:', username, role);
}

main().finally(() => sql.end());
