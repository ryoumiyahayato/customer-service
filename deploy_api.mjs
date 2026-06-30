import https from 'https';
import fs from 'fs';

const TOKEN = 'cfoat_W3nmL57TgaKRsbi32935nfd2StO3d5cxUJ8IItA4CHI.SsRv2HlpzGRd8eafHRIXEyJQxpi8M43e3VMZIboTCR8';
const ACCOUNT_ID = '6709e4edab972e57adc266d3b286a024';
const ZONE_ID = '0e37a4f85be824d9450b2478ade6ffd6';
const SCRIPT_NAME = 'support-chat-cloudflare';

function api(path, method, body) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: 'api.cloudflare.com',
      path: '/client/v4/' + path.replace(/^\/+/, ''),
      method: method || 'GET',
      headers: {
        'Authorization': 'Bearer ' + TOKEN,
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

function uploadWithAssets(workerCode, metadata) {
  return new Promise((resolve, reject) => {
    const boundary = '---' + Math.random().toString(36).slice(2, 16);
    
    let body = '';
    // Part 1: metadata
    body += '--' + boundary + '\r\n';
    body += 'Content-Disposition: form-data; name="metadata"\r\n';
    body += 'Content-Type: application/json\r\n\r\n';
    body += JSON.stringify(metadata) + '\r\n';
    // Part 2: worker.js
    body += '--' + boundary + '\r\n';
    body += 'Content-Disposition: form-data; name="worker.js"; filename="worker.js"\r\n';
    body += 'Content-Type: application/javascript+module\r\n\r\n';
    body += workerCode + '\r\n';
    body += '--' + boundary + '--\r\n';

    const opts = {
      hostname: 'api.cloudflare.com',
      path: '/client/v4/accounts/' + ACCOUNT_ID + '/workers/scripts/' + SCRIPT_NAME,
      method: 'PUT',
      headers: {
        'Authorization': 'Bearer ' + TOKEN,
        'Content-Type': 'multipart/form-data; boundary=' + boundary,
      },
    };
    
    const req = https.request(opts, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { resolve({ raw: data.substring(0, 500) }); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function main() {
  // Read the compiled worker.js
  const workerPath = 'C:\\Users\\agcrf\\Desktop\\learntest\\.wrangler-dry-run\\worker.js';
  if (!fs.existsSync(workerPath)) {
    console.error('ERROR: compiled worker.js not found.');
    process.exit(1);
  }
  const workerCode = fs.readFileSync(workerPath, 'utf-8');
  console.log('Worker size:', workerCode.length, 'bytes');

  // Step 1: Check current bindings
  console.log('\nChecking current script metadata...');
  const scriptInfo = await api('accounts/' + ACCOUNT_ID + '/workers/scripts/' + SCRIPT_NAME);
  if (scriptInfo && scriptInfo.success && scriptInfo.result) {
    console.log('Current script tag:', scriptInfo.result.tag);
    console.log('Has assets:', scriptInfo.result.has_assets);
    console.log('Deployment ID:', scriptInfo.result.deployment_id);
    console.log('Compatibility date:', scriptInfo.result.compatibility_date);
  }

  // Step 2: Upload with proper metadata including ASSETS binding
  // The wrangler.toml defines ASSETS binding - we need to include it in metadata
  console.log('\nUploading worker with proper metadata...');
  
  const metadata = {
    main_module: 'worker.js',
    compatibility_date: '2026-06-26',
    compatibility_flags: ['nodejs_compat'],
    assets: {
      binding: 'ASSETS',
      directory: './dist',
      not_found_handling: 'single-page-application'
    },
    bindings: [
      {
        type: 'd1',
        name: 'DB',
        id: '9cda9221-878e-464f-8f0b-5577deec88af'
      },
      {
        type: 'r2_bucket',
        name: 'UPLOADS',
        bucket_name: 'customer-chat-uploads'
      },
      {
        type: 'durable_object_namespace',
        name: 'CHAT_ROOM',
        class_name: 'ChatRoom'
      },
      {
        type: 'plain_text',
        name: 'VISITOR_ROOT_DOMAIN',
        text: 'vx9qn7zr.org'
      }
    ]
  };
  
  const result = await uploadWithAssets(workerCode, metadata);
  console.log('Upload result:', JSON.stringify(result, null, 2));

  if (result && result.success) {
    console.log('\nWorker deployed successfully!');
    
    console.log('\nWaiting 10s for propagation...');
    await new Promise(r => setTimeout(r, 10000));
    
    // Test
    console.log('\nTesting...');
    const tests = [
      { url: 'https://vx9qn7zr.org/', desc: 'root domain' },
      { url: 'https://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.vx9qn7zr.org/?t=' + Date.now(), desc: '40hex invalid' },
      { url: 'https://abc.vx9qn7zr.org/', desc: 'abc' },
      { url: 'https://bad_token.vx9qn7zr.org/', desc: 'bad_token' },
    ];
    for (const test of tests) {
      try {
        const result2 = await new Promise((resolve, reject) => {
          https.get(test.url, { headers: { 'Cache-Control': 'no-cache' } }, (res) => {
            let d = '';
            res.on('data', c => d += c);
            res.on('end', () => {
              const hasHtml = /<!doctype|<html|<script|<link/i.test(d);
              resolve({
                status: res.statusCode,
                length: d.length,
                html: hasHtml ? 'YES' : 'no',
                snippet: d.substring(0, 100).replace(/\n/g, '\\n').replace(/\r/g, '')
              });
            });
          }).on('error', (e) => {
            resolve({ status: 'ERR:' + e.message, length: 0, html: 'no', snippet: '' });
          });
        });
        console.log(test.desc + ' | ' + result2.status + ' | ' + result2.length + 'B | HTML:' + result2.html);
        if (result2.html === 'YES') console.log('  SNIPPET: ' + result2.snippet);
      } catch (e) {
        console.log(test.desc + ' | ERR: ' + e.message);
      }
    }
  }
}

main();