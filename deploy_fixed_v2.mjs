import https from 'https';
import fs from 'fs';
import { execSync } from 'child_process';
import path from 'path';

const TOKEN = 'cfoat_W3nmL57TgaKRsbi32935nfd2StO3d5cxUJ8IItA4CHI.SsRv2HlpzGRd8eafHRIXEyJQxpi8M43e3VMZIboTCR8';
const ACCT = '6709e4edab972e57adc266d3b286a024';
const NAME = 'support-chat-cloudflare';

function api(method, path, body) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: 'api.cloudflare.com',
      path: '/client/v4/' + path.replace(/^\/+/, ''),
      method,
      headers: { 'Authorization': 'Bearer ' + TOKEN },
    };
    if (body && typeof body === 'string') {
      opts.headers['Content-Type'] = 'application/javascript';
    } else if (body) {
      opts.headers['Content-Type'] = 'application/json';
    }
    const req = https.request(opts, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { resolve({ error: e.message, raw: d.substring(0, 500) }); } });
    });
    req.on('error', reject);
    if (body) req.write(typeof body === 'string' ? body : JSON.stringify(body));
    req.end();
  });
}

function uploadWorker(workerCode) {
  return new Promise((resolve, reject) => {
    const metadata = JSON.stringify({
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
    });

    const boundary = '----FormBoundary' + Math.random().toString(36).substring(2);
    let body = '';
    body += '--' + boundary + '\r\n';
    body += 'Content-Disposition: form-data; name="metadata"\r\n';
    body += 'Content-Type: application/json\r\n\r\n';
    body += metadata + '\r\n';
    body += '--' + boundary + '\r\n';
    body += 'Content-Disposition: form-data; name="worker.js"; filename="worker.js"\r\n';
    body += 'Content-Type: application/javascript\r\n\r\n';
    body += workerCode + '\r\n';
    body += '--' + boundary + '--\r\n';

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

async function main() {
  // Step 1: Build the project with Vite
  console.log('=== Step 1: Building with Vite ===');
  try {
    const buildOutput = execSync('pnpm.cmd build', { cwd: __dirname, encoding: 'utf8', stdio: 'pipe', timeout: 120000 });
    console.log('Build output:', buildOutput.substring(0, 1000));
  } catch (e) {
    console.log('Build error:', e.message);
    console.log('stdout:', e.stdout?.substring(0, 1000));
    console.log('stderr:', e.stderr?.substring(0, 1000));
  }

  // Step 2: Find the built worker
  console.log('\n=== Step 2: Looking for built worker ===');
  const distDir = path.join(__dirname, 'dist');
  if (fs.existsSync(distDir)) {
    const files = fs.readdirSync(distDir);
    console.log('dist/ contents:', files);
    for (const f of files) {
      const fp = path.join(distDir, f);
      const stat = fs.statSync(fp);
      console.log('  ' + f + ': ' + stat.size + 'B' + (stat.isDirectory() ? ' (dir)' : ''));
    }
  }

  // Look in worker directory
  const workerDir = path.join(__dirname, 'dist', 'worker');
  if (fs.existsSync(workerDir)) {
    const files = fs.readdirSync(workerDir);
    console.log('dist/worker/ contents:', files);
    for (const f of files) {
      const fp = path.join(workerDir, f);
      const stat = fs.statSync(fp);
      console.log('  ' + f + ': ' + stat.size + 'B');
    }
  }

  // Step 3: Upload
  const workerPath = path.join(__dirname, 'dist', 'worker.js');
  if (fs.existsSync(workerPath)) {
    const code = fs.readFileSync(workerPath, 'utf8');
    console.log('\n=== Step 3: Uploading worker (' + code.length + 'B) ===');
    const result = await uploadWorker(code);
    console.log('Upload result:', result.success ? 'OK' : JSON.stringify(result.errors || result));
  } else {
    console.log('No worker.js found at dist/worker.js');
    // Try looking for it elsewhere
    if (fs.existsSync(path.join(__dirname, '.wrangler-dry-run', 'worker.js'))) {
      const code = fs.readFileSync(path.join(__dirname, '.wrangler-dry-run', 'worker.js'), 'utf8');
      console.log('\n=== Using dry-run worker.js (' + code.length + 'B) ===');
      const result = await uploadWorker(code);
      console.log('Upload result:', result.success ? 'OK' : JSON.stringify(result.errors || result));
    }
  }
}
main();