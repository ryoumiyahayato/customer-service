import https from 'https';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const TOKEN = 'cfoat_W3nmL57TgaKRsbi32935nfd2StO3d5cxUJ8IItA4CHI.SsRv2HlpzGRd8eafHRIXEyJQxpi8M43e3VMZIboTCR8';
const ACCT = '6709e4edab972e57adc266d3b286a024';
const NAME = 'support-chat-cloudflare';

async function apiGet(path) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: 'api.cloudflare.com',
      path: '/client/v4/accounts/' + ACCT + path,
      method: 'GET',
      headers: { 'Authorization': 'Bearer ' + TOKEN },
    };
    const req = https.request(opts, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { resolve({ error: e.message, raw: d.substring(0, 500) }); } });
    });
    req.on('error', reject);
    req.end();
  });
}

async function main() {
  // Step 1: Check current deployment status
  console.log('Checking current deployment...');
  const status = await apiGet('/workers/services/' + NAME);
  console.log('Script ID:', status?.result?.default_environment?.script?.id?.substring(0, 20) + '...');
  console.log('Modified:', status?.result?.default_environment?.script?.modified_on);
  
  // Step 2: Check if there's a deployment in progress
  const deployments = await apiGet('/workers/services/' + NAME + '/deployments');
  if (deployments?.result) {
    const lastDeploy = Array.isArray(deployments.result) ? deployments.result[deployments.result.length - 1] : deployments.result;
    console.log('Last deployment status:', JSON.stringify(lastDeploy?.status || 'unknown'));
  }
  
  // Step 3: Build the project
  console.log('\nBuilding project...');
  try {
    execSync('npx.cmd vite build', { cwd: 'C:\\Users\\agcrf\\Desktop\\learntest', stdio: 'inherit', timeout: 60000 });
    console.log('Build complete.');
  } catch (e) {
    console.log('Build error (may still have old dist):', e.message.substring(0, 200));
  }

  // Step 4: Read dist/index.html to verify
  if (fs.existsSync('dist/index.html')) {
    const html = fs.readFileSync('dist/index.html', 'utf-8');
    console.log('\ndist/index.html first 200 chars:');
    console.log(html.substring(0, 200));
    console.log('...');
  }

  // Step 5: Check if wrangler is available and try to deploy
  console.log('\nAttempting wrangler deploy...');
  try {
    const result = execSync('npx.cmd wrangler deploy 2>&1', { 
      cwd: 'C:\\Users\\agcrf\\Desktop\\learntest', 
      encoding: 'utf-8', 
      timeout: 120000,
      maxBuffer: 10 * 1024 * 1024
    });
    console.log('Wrangler output:');
    console.log(result);
  } catch (e) {
    console.log('Wrangler error:', e.message.substring(0, 500));
    if (e.stdout) console.log('stdout:', e.stdout.substring(0, 2000));
    if (e.stderr) console.log('stderr:', e.stderr.substring(0, 2000));
  }
  
  // Step 6: Test
  console.log('\nWaiting 15s for propagation...');
  await new Promise(r => setTimeout(r, 15000));
  
  console.log('\nTesting invalid subdomains:');
  const tests = [
    'https://abc.vx9qn7zr.org/',
    'https://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.vx9qn7zr.org/?t=' + Date.now(),
    'https://bad_token.vx9qn7zr.org/',
    'https://vx9qn7zr.org/',
  ];
  for (const url of tests) {
    try {
      const r = await new Promise((resolve, reject) => {
        https.get(url, { headers: { 'Cache-Control': 'no-cache' }, timeout: 15000 }, (res) => {
          let d = '';
          res.on('data', c => d += c);
          res.on('end', () => {
            const hasHtml = /<!doctype|<html|<script|<link|<div/i.test(d.substring(0, 500));
            resolve({
              status: res.statusCode,
              length: d.length,
              html: hasHtml ? 'YES' : 'no',
              snippet: d.substring(0, 100).replace(/\n/g, '\\n').replace(/\r/g, '')
            });
          });
        }).on('error', (e) => resolve({ status: 'ERR:' + e.message, length: 0, html: 'no' }));
      });
      console.log(url.substring(0, 55) + '... | ' + r.status + ' | ' + r.length + 'B | HTML:' + r.html);
      if (r.html === 'YES') console.log('  > SNIPPET:', r.snippet);
    } catch (e) {
      console.log(url.substring(0, 55) + '... | ERR:', e.message.substring(0, 100));
    }
  }
}
main();