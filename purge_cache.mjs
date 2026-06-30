import https from 'https';

const TOKEN = 'cfoat_W3nmL57TgaKRsbi32935nfd2StO3d5cxUJ8IItA4CHI.SsRv2HlpzGRd8eafHRIXEyJQxpi8M43e3VMZIboTCR8';
const ZONE_ID = 'a1efe8405cf9d6ac3540e5b4668e11a3'; // vx9qn7zr.org zone

function api(method, path, body) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: 'api.cloudflare.com',
      path: '/client/v4/' + path.replace(/^\/+/, ''),
      method,
      headers: { 'Authorization': 'Bearer ' + TOKEN, 'Content-Type': 'application/json' },
      timeout: 30000,
    };
    const req = https.request(opts, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { resolve({ error: e.message, raw: d.substring(0, 500) }); } });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function main() {
  // Purge all cache for the zone
  console.log('Purging Cloudflare cache for zone', ZONE_ID);
  const result = await api('POST', 'zones/' + ZONE_ID + '/purge_cache', { purge_everything: true });
  console.log('Purge result:', result.success ? 'SUCCESS' : 'FAILED');
  if (!result.success) {
    console.log(JSON.stringify(result.errors || result, null, 2));
  }
  
  // Wait a moment
  await new Promise(r => setTimeout(r, 2000));
  
  // Now test
  const tests = [
    'https://vx9qn7zr.org/?t=a52',
    'https://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.vx9qn7zr.org/?t=a52',
    'https://abc.vx9qn7zr.org/?t=a52',
    'https://bad_token.vx9qn7zr.org/?t=a52',
  ];
  
  for (const testUrl of tests) {
    console.log('\n=== Testing:', testUrl, '===');
    const resp = await new Promise((resolve, reject) => {
      const opts = {
        hostname: new URL(testUrl).hostname,
        path: new URL(testUrl).pathname + new URL(testUrl).search,
        method: 'GET',
        headers: { 'Cache-Control': 'no-cache' },
        timeout: 15000,
      };
      const req = https.request(opts, (res) => {
        let d = '';
        res.on('data', c => d += c);
        res.on('end', () => {
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: d.substring(0, 500),
          });
        });
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
      req.end();
    });
    console.log('Status:', resp.status);
    console.log('Content-Type:', resp.headers['content-type']);
    console.log('Cache status:', resp.headers['cf-cache-status']);
    console.log('Body preview:', resp.body.substring(0, 200));
    const hasHtml = resp.body.includes('<html') || resp.body.includes('<!DOCTYPE');
    const hasScript = resp.body.includes('<script');
    const hasBlue = resp.body.includes('background') || resp.body.includes('blue');
    const hasLoading = resp.body.includes('加载') || resp.body.includes('loading');
    console.log('Has HTML:', hasHtml, '| Has script:', hasScript, '| Has blue/loading:', hasBlue);
  }
}

main().catch(console.error);