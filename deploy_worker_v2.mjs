import https from 'https';
import fs from 'fs';
import { execSync } from 'child_process';

const TOKEN = 'cfoat_W3nmL57TgaKRsbi32935nfd2StO3d5cxUJ8IItA4CHI.SsRv2HlpzGRd8eafHRIXEyJQxpi8M43e3VMZIboTCR8';
const ACCOUNT_ID = '6709e4edab972e57adc266d3b286a024';
const ZONE_ID = '0e37a4f85be824d9450b2478ade6ffd6';
const SCRIPT_NAME = 'support-chat-cloudflare';

function api(path, method = 'GET', body = null) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: 'api.cloudflare.com',
      path: '/client/v4/' + path.replace(/^\/+/, ''),
      method,
      headers: {
        'Authorization': `Bearer ${TOKEN}`,
        'Content-Type': 'application/json',
      },
    };
    const req = https.request(opts, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { resolve({ raw: data.substring(0, 200) }); }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function main() {
  // 1. Bundle the worker
  console.log('=== Building worker ===');
  try {
    execSync('npx wrangler deploy --dry-run', { cwd: 'C:\\Users\\agcrf\\Desktop\\learntest', stdio: 'inherit' });
  } catch (e) {
    console.log('Dry-run failed (expected without login), proceeding with direct upload...');
  }

  // Read the raw worker source
  const workerCode = fs.readFileSync('C:\\Users\\agcrf\\Desktop\\learntest\\src\\worker.ts', 'utf-8');
  
  // Upload the worker script via API
  console.log('\n=== Uploading worker ===');
  const uploadResult = await api(
    `accounts/${ACCOUNT_ID}/workers/scripts/${SCRIPT_NAME}`,
    'PUT',
    {
      main_module: workerCode,
      compatibility_date: '2026-06-26',
      compatibility_flags: ['nodejs_compat'],
    }
  );
  console.log('Upload result:', JSON.stringify(uploadResult, null, 2));

  // 2. Purge cache
  console.log('\n=== Purging cache ===');
  const purge = await api(`zones/${ZONE_ID}/purge_cache`, 'POST', { purge_everything: true });
  console.log('Purge result:', JSON.stringify(purge, null, 2));

  console.log('\n=== Done ===');
}

main();