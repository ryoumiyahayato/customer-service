import { execSync } from 'child_process';
import fs from 'fs';

const CF_TOKEN = 'cfoat_W3nmL57TgaKRsbi32935nfd2StO3d5cxUJ8IItA4CHI.SsRv2HlpzGRd8eafHRIXEyJQxpi8M43e3VMZIboTCR8';
const CF_ACCOUNT = '6709e4edab972e57adc266d3b286a024';
const WORKER_NAME = 'learn-worker';

// Read the worker.ts file
let workerCode = fs.readFileSync('src/worker.ts', 'utf-8');

// Bundle as single file
const bundled = `// Auto-deployed ${new Date().toISOString()}
// handleFetch is the main entry
export default {
  async fetch(request, env) {
    // ... worker code inline ...
    ${workerCode}
  }
};
`;

// Actually we need to detect the export default and wrap properly
// Let's parse the original file to find the export default
const exportMatch = workerCode.match(/export\s+default\s*\{[\s\S]*\};?/);
if (!exportMatch) {
  console.error('ERROR: Could not find export default in worker.ts');
  process.exit(1);
}

const fetchHandler = exportMatch[0]
  .replace(/^export\s+default\s+/, '')
  .replace(/;\s*$/, '');

// Build minimal worker
const minWorker = `// Deployed ${new Date().toISOString()}
import { ChatRoom } from './durable-objects/ChatRoom';

export { ChatRoom };

export default ${fetchHandler};
`;

// Write to a temp file
fs.writeFileSync('_deploy_main.ts', minWorker);

// Use wrangler to deploy
console.log('Deploying worker via wrangler...');
try {
  const out = execSync('npx wrangler deploy --main _deploy_main.ts', {
    cwd: process.cwd(),
    timeout: 120000,
    maxBuffer: 10 * 1024 * 1024,
    env: {
      ...process.env,
      CLOUDFLARE_API_TOKEN: CF_TOKEN,
      CLOUDFLARE_ACCOUNT_ID: CF_ACCOUNT,
    }
  });
  console.log('=== STDOUT ===');
  console.log(out.toString('utf-8'));
} catch (e) {
  console.log('=== STDERR ===');
  console.log(e.stderr?.toString('utf-8'));
  console.log('=== STDOUT ===');
  console.log(e.stdout?.toString('utf-8'));
}