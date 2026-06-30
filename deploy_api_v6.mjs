import https from 'https';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const TOKEN = 'cfoat_W3nmL57TgaKRsbi32935nfd2StO3d5cxUJ8IItA4CHI.SsRv2HlpzGRd8eafHRIXEyJQxpi8M43e3VMZIboTCR8';
const ACCT = '6709e4edab972e57adc266d3b286a024';
const NAME = 'support-chat-cloudflare';

async function deploy() {
  // Step 1: Read compiled worker.js from .wrangler-dry-run
  const workerPath = path.join(__dirname, '.wrangler-dry-run', 'worker.js');
  if (!fs.existsSync(workerPath)) {
    console.error('worker.js not found at', workerPath);
    process.exit(1);
  }
  const workerCode = fs.readFileSync(workerPath, 'utf8');
  console.log(`Worker code: ${(workerCode.length / 1024).toFixed(1)} KB`);

  // Step 2: Gather all assets from dist/
  const distDir = path.join(__dirname, 'dist');
  if (!fs.existsSync(distDir)) {
    console.error('dist/ not found');
    process.exit(1);
  }

  const assetFiles = [];
  function collectFiles(dir, relativePath) {
    if (!fs.existsSync(dir)) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        collectFiles(full, relativePath ? relativePath + '/' + e.name : e.name);
      } else {
        assetFiles.push({
          filePath: full,
          relativePath: relativePath ? relativePath + '/' + e.name : e.name,
        });
      }
    }
  }
  collectFiles(distDir, '');
  
  // Filter out any stray files we don't want
  const assets = assetFiles.filter(f => {
    const lower = f.relativePath.toLowerCase();
    // Skip non-asset files at root level
    if (!lower.includes('/') && lower !== 'index.html') return false;
    return true;
  });
  console.log(`Assets: ${assets.length} files (${assets.reduce((s, f) => s + fs.statSync(f.filePath).size, 0) / 1024 / 1024 | 0} MB)`);

  // Step 3: Build metadata with assets bindings
  const assetManifest = {};
  for (const a of assets) {
    assetManifest[a.relativePath] = { hash: '' }; // hash not needed for API upload
  }

  const metadata = {
    main_module: 'worker.js',
    bindings: [
      { type: 'd1_database', name: 'DB', id: '5216b2eb-06ef-4777-9aa5-2e2ecf54f37e' },
      { type: 'r2_bucket', name: 'UPLOADS', bucket_name: 'support-chat-uploads' },
      { type: 'durable_object_namespace', name: 'CHAT_ROOM', class_name: 'ChatRoom' },
    ],
    compatibility_date: '2026-06-30',
    compatibility_flags: ['nodejs_compat'],
  };

  // Step 4: Build multipart form
  const boundary = '----FormBoundary' + Math.random().toString(36).substring(2);
  const parts = [];
  
  function addPart(name, content, contentType, filename) {
    let header = '--' + boundary + '\r\n';
    header += 'Content-Disposition: form-data; name="' + name + '"';
    if (filename) header += '; filename="' + filename + '"';
    header += '\r\n';
    header += 'Content-Type: ' + contentType + '\r\n\r\n';
    parts.push({ type: 'buffer', data: Buffer.from(header, 'utf8') });
    parts.push({ type: 'buffer', data: Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8') });
    parts.push({ type: 'buffer', data: Buffer.from('\r\n', 'utf8') });
  }

  // Add metadata part
  addPart('metadata', JSON.stringify(metadata), 'application/json');

  // Add worker.js part
  addPart('worker.js', workerCode, 'application/javascript', 'worker.js');

  // Add SPA index.html as the main asset
  const indexHtml = assets.find(a => a.relativePath === 'index.html');
  if (indexHtml) {
    const content = fs.readFileSync(indexHtml.filePath);
    addPart('index.html', content, 'text/html', 'index.html');
  }

  // Add all other assets
  const mimeMap = {
    '.js': 'application/javascript',
    '.css': 'text/css',
    '.html': 'text/html',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.txt': 'text/plain',
    '.map': 'application/octet-stream',
  };

  for (const asset of assets) {
    if (asset.relativePath === 'index.html') continue; // already added
    const ext = path.extname(asset.relativePath).toLowerCase();
    const mime = mimeMap[ext] || 'application/octet-stream';
    const content = fs.readFileSync(asset.filePath);
    addPart(asset.relativePath, content, mime, asset.relativePath);
  }

  // Add closing boundary
  parts.push({ type: 'buffer', data: Buffer.from('--' + boundary + '--\r\n', 'utf8') });

  // Calculate total length
  const bodyBuffers = parts.map(p => p.data);
  const body = Buffer.concat(bodyBuffers);
  console.log(`Total body: ${(body.length / 1024 / 1024).toFixed(2)} MB`);

  // Step 5: Upload to Cloudflare API
  console.log('\n=== Uploading to Cloudflare API ===');
  const result = await new Promise((resolve, reject) => {
    const opts = {
      hostname: 'api.cloudflare.com',
      path: '/client/v4/accounts/' + ACCT + '/workers/scripts/' + NAME,
      method: 'PUT',
      headers: {
        'Authorization': 'Bearer ' + TOKEN,
        'Content-Type': 'multipart/form-data; boundary=' + boundary,
        'Content-Length': body.length,
      },
      timeout: 120000,
    };
    const req = https.request(opts, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        console.log('Status:', res.statusCode);
        try { resolve(JSON.parse(d)); } catch (e) { resolve({ error: e.message, raw: d.substring(0, 1000) }); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.write(body);
    req.end();
  });

  console.log('Upload result:', result.success ? 'SUCCESS' : 'FAILED');
  if (!result.success) {
    console.log(JSON.stringify(result.errors || result, null, 2));
    if (result.raw) console.log('Raw:', result.raw);
    return;
  }

  console.log('Upload OK, script tag:', result.result?.id?.substring(0, 40) || 'N/A');

  // Step 6: Deploy the version
  // First, get available versions
  const versionsResp = await new Promise((resolve, reject) => {
    const opts = {
      hostname: 'api.cloudflare.com',
      path: '/client/v4/accounts/' + ACCT + '/workers/scripts/' + NAME + '/versions',
      method: 'GET',
      headers: { 'Authorization': 'Bearer ' + TOKEN },
    };
    const req = https.request(opts, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { resolve({ error: e.message }); } });
    });
    req.on('error', reject);
    req.end();
  });

  // Find the latest version
  const versions = versionsResp.result || [];
  if (versions.length === 0) {
    console.log('No versions found to deploy');
    return;
  }

  const latestVersion = versions[versions.length - 1];
  const versionId = latestVersion?.id;
  if (!versionId) {
    console.log('No version ID found');
    return;
  }

  console.log('Latest version ID:', versionId.substring(0, 40));

  // Deploy the version to 100%
  console.log('Deploying version...');
  const deployResp = await new Promise((resolve, reject) => {
    const body2 = JSON.stringify({
      strategy: 'percentage',
      versions: [{ version_id: versionId, percentage: 100 }],
      source: 'api',
      annotations: { 'workers/message': 'Fix: host gate 404/410 before SPA + remove blue/loading' }
    });
    const opts = {
      hostname: 'api.cloudflare.com',
      path: '/client/v4/accounts/' + ACCT + '/workers/scripts/' + NAME + '/deployments',
      method: 'PUT',
      headers: {
        'Authorization': 'Bearer ' + TOKEN,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body2),
      },
    };
    const req = https.request(opts, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { resolve({ error: e.message }); } });
    });
    req.on('error', reject);
    req.write(body2);
    req.end();
  });
  console.log('Deploy result:', deployResp.success ? 'SUCCESS' : 'FAILED');
  if (!deployResp.success) {
    console.log(JSON.stringify(deployResp.errors || deployResp, null, 2));
  }
}

deploy().catch(console.error);