import https from 'https';
const TOKEN = 'cfoat_W3nmL57TgaKRsbi32935nfd2StO3d5cxUJ8IItA4CHI.SsRv2HlpzGRd8eafHRIXEyJQxpi8M43e3VMZIboTCR8';
const ACCT = '6709e4edab972e57adc266d3b286a024';
const NAME = 'support-chat-cloudflare';

function api(method, path, body) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: 'api.cloudflare.com',
      path: '/client/v4/' + path.replace(/^\/+/, ''),
      method,
      headers: { 'Authorization': 'Bearer ' + TOKEN, 'Content-Type': 'application/json' },
    };
    const req = https.request(opts, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { resolve({ error: e.message, raw: d.substring(0, 500) }); } });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function main() {
  // Roll back to the last wrangler deployment version: 3fe4b120-f724-492a-a513-6f8ddc3e487a
  const versionId = '3fe4b120-f724-492a-a513-6f8ddc3e487a';
  console.log('Rolling back to version:', versionId);
  
  const result = await api('PUT', 'accounts/' + ACCT + '/workers/scripts/' + NAME + '/deployments', {
    strategy: 'percentage',
    versions: [{ version_id: versionId, percentage: 100 }],
    source: 'api',
    annotations: { 'workers/message': 'Rollback to pre-fix version due to broken API deploy' }
  });
  
  console.log(JSON.stringify(result, null, 2));
  
  if (result.success) {
    console.log('\nRollback successful! Waiting 15s...');
    await new Promise(r => setTimeout(r, 15000));
    
    console.log('\nTesting root domain...');
    const test = await new Promise((resolve, reject) => {
      https.get('https://vx9qn7zr.org/', { headers: { 'Cache-Control': 'no-cache' } }, (res) => {
        let d = '';
        res.on('data', c => d += c);
        res.on('end', () => resolve({ status: res.statusCode, length: d.length }));
      }).on('error', reject);
    });
    console.log('Root domain:', test.status, '-', test.length + 'B');
  }
}
main();