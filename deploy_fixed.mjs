import https from 'https';
import fs from 'fs';

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

async function main() {
  // Strategy: Rollback to the last known good wrangler version
  // First delete the broken API-deployed script
  console.log('=== Step 1: Delete current script ===');
  const del = await api('DELETE', 'accounts/' + ACCT + '/workers/scripts/' + NAME);
  console.log('Delete result:', del.success ? 'OK' : del.errors?.[0]?.message || 'unknown');

  // Wait a moment
  await new Promise(r => setTimeout(r, 3000));

  // Now redeploy from the version we know works (the wrangler-deployed one)
  // Actually, we need to re-upload. Let me check if we can get the last good version metadata
  console.log('\n=== Step 2: Check deployments ===');
  const deps = await api('GET', 'accounts/' + ACCT + '/workers/scripts/' + NAME + '/deployments');
  if (deps?.result?.deployments) {
    for (const d of deps.result.deployments) {
      console.log('Deploy:', d.id?.substring(0, 36), '| Ver:', d.versions?.[0]?.version_id?.substring(0,36), '| Source:', d.source, '| Created:', d.created_on);
    }
  }

  console.log('\n=== Step 3: Try to rollback via PUT deployment ===');
  // Use the last good wrangler version
  const versionId = '3fe4b120-f724-492a-a513-6f8ddc3e487a';
  const rollback = await api('PUT', 'accounts/' + ACCT + '/workers/scripts/' + NAME + '/deployments', {
    strategy: 'percentage',
    versions: [{ version_id: versionId, percentage: 100 }],
    source: 'api',
    annotations: { 'workers/message': 'Rollback to pre-fix wrangler version' }
  });
  console.log('Rollback:', rollback.success ? 'OK' : JSON.stringify(rollback.errors || rollback));
}
main();