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
  // First get all versions
  console.log('=== Getting versions ===');
  const versions = await api('GET', 'accounts/' + ACCT + '/workers/scripts/' + NAME + '/versions?page=1&per_page=20');
  if (versions?.result) {
    console.log('Total versions:', versions.result.length);
    console.log('');
    for (const v of versions.result) {
      console.log('ID:', v.id?.substring(0, 36), '| Date:', v.created_on, '| Passes:', v.validation_state?.state || 'N/A');
    }
  }

  // Get current deployment info
  console.log('\n=== Getting latest deployment info ===');
  const deps = await api('GET', 'accounts/' + ACCT + '/workers/scripts/' + NAME + '/deployments');
  if (deps?.result?.deployments) {
    const active = deps.result.deployments.filter(d => d.strategy === 'percentage');
    console.log('Active deployments:', JSON.stringify(active.map(d => ({ id: d.id, version: d.versions?.[0]?.version_id?.substring(0,36), message: d.annotations?.['workers/message'] })), null, 2));
  }

  // Get script content to verify
  console.log('\n=== Getting script content ===');
  const script = await api('GET', 'accounts/' + ACCT + '/workers/scripts/' + NAME);
  console.log('Main module size:', script?.result?.main_module_size || 'N/A');
}
main();