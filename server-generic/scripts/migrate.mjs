const mode = process.argv[2] || 'up';

if (!['up', 'status'].includes(mode)) {
  console.error('Usage: npm run migrate -- up | npm run migrate:status');
  process.exitCode = 1;
} else {
  console.log(`server-generic PostgreSQL migration mode: ${mode}`);
  process.argv = [process.argv[0], process.argv[1], ...(mode === 'status' ? ['--status'] : [])];
  await import('../dist/db/migrate.js');
}
