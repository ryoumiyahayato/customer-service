import https from 'https';
import fs from 'fs';
const TOKEN = 'cfoat_W3nmL57TgaKRsbi32935nfd2StO3d5cxUJ8IItA4CHI.SsRv2HlpzGRd8eafHRIXEyJQxpi8M43e3VMZIboTCR8';
const ACCT = '6709e4edab972e57adc266d3b286a024';
const NAME = 'support-chat-cloudflare';

async function main() {
  // Read the compiled worker from wrangler build
  const paths = [
    'dist/worker/worker.js',
    '.wrangler-dry-run/worker.js',
  ];
  let workerCode;
  for (const p of paths) {
    if (fs.existsSync(p)) {
      workerCode = fs.readFileSync(p, 'utf-8');
      console.log('Found at:', p, '-', workerCode.length, 'bytes');
      break;
    }
  }
  
  if (!workerCode) {
    // Try to build first
    console.log('No compiled worker found. Need to build via wrangler.');
    return;
  }
  
  // Upload via API with proper metadata including ASSETS
  const boundary = '----' + Math.random().toString(36).slice(2);
  
  // Build multipart body
  const lines = [];
  lines.push('--' + boundary);
  lines.push('Content-Disposition: form-data; name="metadata"');
  lines.push('Content-Type: application/json');
  lines.push('');
  lines.push(JSON.stringify({
    main_module: 'worker.js',
    compatibility_date: '2026-06-26',
    compatibility_flags: ['nodejs_compat'],
    assets: {
      binding: 'ASSETS',
      directory: './dist',
      not_found_handling: 'single-page-application'
    },
    bindings: [
      { type: 'd1', name: 'DB', id: '9cda9221-878e-464f-8f0b-5577deec88af' },
      { type: 'r2_bucket', name: 'UPLOADS', bucket_name: 'customer-chat-uploads' },
      { type: 'durable_object_namespace', name: 'CHAT_ROOM', class_name: 'ChatRoom' },
      { type: 'plain_text', name: 'VISITOR_ROOT_DOMAIN', text: 'vx9qn7zr.org' }
    ]
  }));
  lines.push('--' + boundary);
  lines.push('Content-Disposition: form-data; name="worker.js"; filename="worker.js"');
  lines.push('Content-Type: application/javascript+module');
  lines.push('');
  lines.push(workerCode);
  lines.push('--' + boundary + '--');
  
  const body = lines.join('\r\n');
  
  console.log('Uploading', body.length, 'bytes with assets config...');
  
  const result = await new Promise((resolve, reject) => {
    const opts = {
      hostname: 'api.cloudflare.com',
      path: '/client/v4/accounts/' + ACCT + '/workers/scripts/' + NAME,
      method: 'PUT',
      headers: {
        'Authorization': 'Bearer ' + TOKEN,
        'Content-Type': 'multipart/form-data; boundary=' + boundary,
      },
    };
    const req = https.request(opts, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { resolve({ error: e.message, raw: d.substring(0, 500) }); } });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
  
  console.log(JSON.stringify(result, null, 2));
}
main();