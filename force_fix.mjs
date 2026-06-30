import https from 'https';

const TOKEN = 'cfoat_W3nmL57TgaKRsbi32935nfd2StO3d5cxUJ8IItA4CHI.SsRv2HlpzGRd8eafHRIXEyJQxpi8M43e3VMZIboTCR8';
const ACCT = '6709e4edab972e57adc266d3b286a024';
const NAME = 'support-chat-cloudflare';

function api(method, path, body) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: 'api.cloudflare.com',
      path: '/client/v4/' + path.replace(/^\/+/, ''),
      method,
      headers: { 'Authorization': 'Bearer ' + TOKEN, 'Content-Type': 'application/json' },
    };
    const req = https.request(opts, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { resolve({ error: e.message, raw: d.substring(0, 500) }); } });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

// Read compiled worker.js from the actual wrangler build cache
// The dry-run output is incomplete. We need to find the real built worker.
import fs from 'fs';
import path from 'path';

function findBuiltWorker(dir, depth = 0) {
  if (depth > 8) return null;
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        const found = findBuiltWorker(p, depth + 1);
        if (found) return found;
      } else if (e.name === 'worker.js' && fs.statSync(p).size > 50000) {
        return p;
      }
    }
  } catch {}
  return null;
}

async function main() {
  // Check current deployment
  console.log('=== Current deployment ===');
  const curr = await api('GET', 'accounts/' + ACCT + '/workers/scripts/' + NAME);
  console.log('Script exists:', !!curr?.result?.id);
  console.log('Last modified:', curr?.result?.modified_on);

  // Check deployments
  console.log('\n=== Deployments ===');
  const deps = await api('GET', 'accounts/' + ACCT + '/workers/scripts/' + NAME + '/deployments');
  if (deps?.result?.deployments) {
    for (const d of deps.result.deployments) {
      console.log('ID:', d.id?.substring(0, 36), '| Version:', d.versions?.[0]?.version_id?.substring(0, 36), '| Created:', d.created_on, '| Source:', d.source, '| Message:', d.annotations?.['workers/message'] || '(none)');
    }
  }

  // Look for the real worker.js built by wrangler
  const realWorkerPath = findBuiltWorker('.');
  console.log('\n=== Looking for real built worker ===');
  if (realWorkerPath) {
    console.log('Found:', realWorkerPath, '-', fs.statSync(realWorkerPath).size + 'B');
  } else {
    console.log('No properly built worker.js found (>50KB)');
    // Check what we have
    const files = ['.wrangler-dry-run/worker.js'];
    for (const f of files) {
      if (fs.existsSync(f)) {
        const size = fs.statSync(f).size;
        console.log(f + ': ' + size + 'B');
      }
    }
  }
}
main();