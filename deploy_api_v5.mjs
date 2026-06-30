import https from 'https';
import fs from 'fs';
import { execSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { Readable } from 'stream';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const TOKEN = 'cfoat_W3nmL57TgaKRsbi32935nfd2StO3d5cxUJ8IItA4CHI.SsRv2HlpzGRd8eafHRIXEyJQxpi8M43e3VMZIboTCR8';
const ACCT = '6709e4edab972e57adc266d3b286a024';
const NAME = 'support-chat-cloudflare';

/**
 * Upload a worker with assets via Cloudflare API using multipart form
 */
async function uploadWithAssets() {
  // Step 1: Build with Vite
  console.log('=== Building with Vite ===');
  try {
    const out = execSync('pnpm.cmd build', { cwd: __dirname, encoding: 'utf8', timeout: 120000 });
    console.log('Build OK');
  } catch (e) {
    console.error('Build failed:', e.message);
    console.error('stdout:', e.stdout?.substring(0, 2000));
    console.error('stderr:', e.stderr?.substring(0, 2000));
    return;
  }

  // Step 2: Find worker.js and dist directory
  const workerPath = path.join(__dirname, 'dist', 'worker.js');
  if (!fs.existsSync(workerPath)) {
    console.error('No worker.js found at', workerPath);
    // Check what's in dist/
    const distDir = path.join(__dirname, 'dist');
    if (fs.existsSync(distDir)) {
      console.log('dist/ contents:', fs.readdirSync(distDir));
      // Recursively find worker.js
      function findRec(dir) {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const e of entries) {
          const full = path.join(dir, e.name);
          if (e.isDirectory()) findRec(full);
          else if (e.name === 'worker.js') console.log('Found at:', full);
        }
      }
      findRec(distDir);
    }
    return;
  }

  const workerCode = fs.readFileSync(workerPath, 'utf8');
  console.log(`Worker code: ${workerCode.length} bytes`);

  // Step 3: Build multipart form with all dist/ assets
  const distDir = path.join(__dirname, 'dist');
  
  // Gather all files in dist/ (except worker.js which is uploaded separately)
  const assetFiles = [];
  function collectFiles(dir, relativePath) {
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
  
  // Filter out worker.js from assets (it's uploaded as the worker script)
  const assets = assetFiles.filter(f => f.relativePath !== 'worker.js');
  console.log(`Found ${assets.length} asset files to upload`);

  // Build metadata
  const metadata = {
    main_module: "worker.js",
    bindings: [
      { type: "d1", name: "DB", id: "5216b2eb-06ef-4777-9aa5-2e2ecf54f37e" },
      { type: "r2", name: "UPLOADS", bucket_name: "support-chat-uploads" },
      { type: "durable_object_namespace", name: "CHAT_ROOM", class_name: "ChatRoom" },
      { type: "assets", name: "ASSETS", directory: "./dist" },
      { type: "secret_text", name: "SESSION_SECRET" },
    ],
    compatibility_date: "2026-06-30",
    compatibility_flags: ["nodejs_compat"],
  };

  // Build multipart form
  const boundary = '----FormBoundary' + Math.random().toString(36).substring(2);
  const chunks = [];

  function addPart(name, content, contentType, filename) {
    let header = '--' + boundary + '\r\n';
    header += 'Content-Disposition: form-data; name="' + name + '"';
    if (filename) header += '; filename="' + filename + '"';
    header += '\r\n';
    header += 'Content-Type: ' + contentType + '\r\n\r\n';
    chunks.push(Buffer.from(header));
    chunks.push(Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8'));
    chunks.push(Buffer.from('\r\n'));
  }

  // Add metadata
  addPart('metadata', JSON.stringify(metadata), 'application/json');

  // Add worker.js
  addPart('worker.js', workerCode, 'application/javascript', 'worker.js');

  // Add all asset files
  for (const asset of assets) {
    const ext = path.extname(asset.relativePath).toLowerCase();
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
    const mime = mimeMap[ext] || 'application/octet-stream';
    const content = fs.readFileSync(asset.filePath);
    
    const partName = 'asset-' + asset.relativePath.replace(/[\/\\]/g, '-').replace(/[^a-zA-Z0-9_-]/g, '_');
    addPart(partName, content, mime, asset.relativePath);
  }

  // Add closing boundary
  chunks.push(Buffer.from('--' + boundary + '--\r\n'));

  const body = Buffer.concat(chunks);
  console.log(`Total body size: ${(body.length / 1024 / 1024).toFixed(2)} MB`);

  // Upload
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

  console.log('Upload:', result.success ? 'OK' : JSON.stringify(result.errors || result));

  if (result.success) {
    console.log('\n=== Deploying the version ===');
    // Get the version ID from the script upload
    const versionId = result.result?.id;
    console.log('Version ID:', versionId?.substring(0, 40));

    if (versionId) {
      // Deploy it
      const deploy = await new Promise((resolve, reject) => {
        const body2 = JSON.stringify({
          strategy: 'percentage',
          versions: [{ version_id: versionId, percentage: 100 }],
          source: 'api',
          annotations: { 'workers/message': 'Deploy from API v5 with assets' }
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
          res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { resolve({ error: e.message, raw: d.substring(0, 500) }); } });
        });
        req.on('error', reject);
        req.write(body2);
        req.end();
      });
      console.log('Deploy:', deploy.success ? 'OK' : JSON.stringify(deploy.errors || deploy));
    }
  }
}

uploadWithAssets().catch(console.error);