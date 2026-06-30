import https from 'https';
import fs from 'fs';
import path from 'path';

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
        try {
          resolve(JSON.parse(data));
        } catch {
          resolve({ raw: data.substring(0, 200) });
        }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function main() {
  // Step 1: Upload the worker script source
  const workerSourcePath = 'C:\\Users\\agcrf\\Desktop\\learntest\\src\\worker.ts';
  console.log('Worker source exists:', fs.existsSync(workerSourcePath));
  
  // We need to bundle the worker first. Let's check if wrangler can do a dry-run
  // Actually, let's first check existing worker routes
  const routes = await api(`zones/${ZONE_ID}/workers/routes`);
  console.log('Current routes:', JSON.stringify(routes, null, 2).substring(0, 500));
  
  // Check if the worker exists
  const worker = await api(`accounts/${ACCOUNT_ID}/workers/scripts/${SCRIPT_NAME}`);
  console.log('Worker exists:', JSON.stringify(worker, null, 2).substring(0, 300));
  
  // Check worker versions
  const versions = await api(`accounts/${ACCOUNT_ID}/workers/scripts/${SCRIPT_NAME}/versions`);
  console.log('Versions count:', JSON.stringify(versions, null, 2).substring(0, 500));
}

main();