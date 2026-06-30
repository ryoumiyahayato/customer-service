import https from 'https';
import fs from 'fs';
import path from 'path';

const TOKEN = 'cfoat_W3nmL57TgaKRsbi32935nfd2StO3d5cxUJ8IItA4CHI.SsRv2HlpzGRd8eafHRIXEyJQxpi8M43e3VMZIboTCR8';
const ACCT = '6709e4edab972e57adc266d3b286a024';
const NAME = 'support-chat-cloudflare';

// Upload worker + assets via multipart
async function deployWorker(workerCode, assetFiles) {
  const boundary = '----' + Math.random().toString(36).slice(2);
  const lines = [];

  // Part 1: metadata
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
      { type: 'd1', name: 'DB', id: '9cda9221-878e-464f-8f0b-5577deec88af' },
      { type: 'r2_bucket', name: 'UPLOADS', bucket_name: 'customer-chat-uploads' },
      { type: 'durable_object_namespace', name: 'CHAT_ROOM', class_name: 'ChatRoom' },
      { type: 'plain_text', name: 'VISITOR_ROOT_DOMAIN', text: 'vx9qn7zr.org' }
    ]
  };

  lines.push('--' + boundary);
  lines.push('Content-Disposition: form-data; name="metadata"');
  lines.push('Content-Type: application/json');
  lines.push('');
  lines.push(JSON.stringify(metadata));

  // Part 2: worker.js
  lines.push('--' + boundary);
  lines.push('Content-Disposition: form-data; name="worker.js"; filename="worker.js"');
  lines.push('Content-Type: application/javascript+module');
  lines.push('');
  lines.push(workerCode);

  // Part 3+: asset files
  for (const [assetPath, assetContent] of assetFiles) {
    const relativePath = path.relative('dist', assetPath).replace(/\\/g, '/');
    lines.push('--' + boundary);
    lines.push('Content-Disposition: form-data; name="' + relativePath + '"; filename="' + relativePath + '"');
    
    if (relativePath.endsWith('.js')) {
      lines.push('Content-Type: application/javascript');
    } else if (relativePath.endsWith('.css')) {
      lines.push('Content-Type: text/css');
    } else if (relativePath.endsWith('.html')) {
      lines.push('Content-Type: text/html');
    } else if (relativePath.endsWith('.json')) {
      lines.push('Content-Type: application/json');
    } else if (relativePath.endsWith('.svg')) {
      lines.push('Content-Type: image/svg+xml');
    } else if (relativePath.endsWith('.png')) {
      lines.push('Content-Type: image/png');
    } else if (relativePath.endsWith('.ico')) {
      lines.push('Content-Type: image/x-icon');
    } else {
      lines.push('Content-Type: text/plain');
    }
    lines.push('');
    lines.push(assetContent);
  }

  lines.push('--' + boundary + '--');
  const body = lines.join('\r\n');

  return new Promise((resolve, reject) => {
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
}

// Get all files recursively
function getAssetFiles(dir) {
  const files = [];
  if (!fs.existsSync(dir)) return files;
  
  function walk(d) {
    const entries = fs.readdirSync(d, { withFileTypes: true });
    for (const entry of entries) {
      const p = path.join(d, entry.name);
      if (entry.isDirectory()) {
        walk(p);
      } else if (entry.isFile()) {
        files.push(p);
      }
    }
  }
  walk(dir);
  return files;
}

async function main() {
  // Read worker code
  const workerPaths = ['.wrangler-dry-run/worker.js', 'node_modules/.cache/wrangler/worker.js'];
  let workerCode = null;
  for (const wp of workerPaths) {
    if (fs.existsSync(wp)) {
      workerCode = fs.readFileSync(wp, 'utf-8');
      console.log('Worker found at:', wp, '-', workerCode.length, 'bytes');
      break;
    }
  }

  if (!workerCode) {
    // Try to find the latest compiled worker
    const cacheDir = 'node_modules/.cache';
    if (fs.existsSync(cacheDir)) {
      function findWorker(dir, depth = 0) {
        if (depth > 5) return null;
        try {
          const entries = fs.readdirSync(dir, { withFileTypes: true });
          for (const e of entries) {
            const p = path.join(dir, e.name);
            if (e.isDirectory()) {
              const found = findWorker(p, depth + 1);
              if (found) return found;
            } else if (e.name === 'worker.js') {
              return p;
            }
          }
        } catch {}
        return null;
      }
      const found = findWorker(cacheDir);
      if (found) {
        workerCode = fs.readFileSync(found, 'utf-8');
        console.log('Worker found at:', found, '-', workerCode.length, 'bytes');
      }
    }
  }

  if (!workerCode) {
    console.log('No compiled worker found. Building from source...');
    // Read src/worker.ts directly and build inline
    workerCode = fs.readFileSync('src/worker.ts', 'utf-8');
    console.log('Read src/worker.ts:', workerCode.length, 'bytes');
    
    // Write to a temporary file
    fs.writeFileSync('.wrangler-dry-run/worker.js', workerCode);
  }

  // Get all asset files from dist
  const assetPaths = getAssetFiles('dist');
  console.log('Asset files found:', assetPaths.length);
  
  const assetFiles = [];
  for (const ap of assetPaths) {
    const content = fs.readFileSync(ap, 'utf-8');
    assetFiles.push([ap, content]);
    console.log('  Adding asset:', path.relative('dist', ap), '-', content.length, 'bytes');
  }

  console.log('\nDeploying worker with', assetFiles.length, 'asset files...');
  const result = await deployWorker(workerCode, assetFiles);
  console.log(JSON.stringify(result, null, 2));

  if (result && result.success) {
    console.log('\nDeployment successful! Waiting 10s for propagation...');
    await new Promise(r => setTimeout(r, 10000));

    console.log('\nTesting...');
    const tests = [
      'https://vx9qn7zr.org/',
      'https://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.vx9qn7zr.org/?t=' + Date.now(),
      'https://abc.vx9qn7zr.org/',
      'https://bad_token.vx9qn7zr.org/',
    ];
    for (const url of tests) {
      try {
        const r = await new Promise((resolve, reject) => {
          https.get(url, { headers: { 'Cache-Control': 'no-cache' } }, (res) => {
            let d = '';
            res.on('data', c => d += c);
            res.on('end', () => {
              const hasHtml = /<!doctype|<html|<script|<link/i.test(d);
              resolve({
                status: res.statusCode,
                length: d.length,
                html: hasHtml ? 'YES' : 'no',
                snippet: d.substring(0, 80).replace(/\n/g, '\\n').replace(/\r/g, '')
              });
            });
          }).on('error', (e) => resolve({ status: 'ERR:' + e.message, length: 0, html: 'no' }));
        });
        console.log(url.substring(0, 60) + '... | ' + r.status + ' | ' + r.length + 'B | HTML:' + r.html);
        if (r.html === 'YES') console.log('  SNIPPET:', r.snippet);
      } catch (e) {
        console.log(url.substring(0, 60) + '... | ERR:', e.message);
      }
    }
  }
}
main();