import https from 'https';

const TOKEN = 'cfoat_W3nmL57TgaKRsbi32935nfd2StO3d5cxUJ8IItA4CHI.SsRv2HlpzGRd8eafHRIXEyJQxpi8M43e3VMZIboTCR8';
const ZONE_ID = '0e37a4f85be824d9450b2478ade6ffd6';

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
  console.log('Purging Cloudflare cache for zone', ZONE_ID);
  const result = await api('POST', 'zones/' + ZONE_ID + '/purge_cache', { purge_everything: true });
  console.log('Purge result:', result.success ? 'SUCCESS' : 'FAILED');
  if (!result.success) {
    console.log(JSON.stringify(result.errors || result, null, 2));
  }
  
  // Wait for purge
  await new Promise(r => setTimeout(r, 3000));
  
  console.log('\n=== Testing invalid domains (with cache buster) ===\n');
  
  const tests = [
    'https://abc.vx9qn7zr.org/?t=a52',
    'https://bad_token.vx9qn7zr.org/?t=a52',
    'https://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.vx9qn7zr.org/?t=a52',
    'https://vx9qn7zr.org/?t=a52',
  ];
  
  for (const url of tests) {
    const cb = Date.now() + Math.random().toString(36).slice(2, 8);
    const fullUrl = url + '&cb=' + cb;
    const u = new URL(fullUrl);
    console.log('\n---', u.hostname + u.pathname + u.search, '---');
    
    const resp = await new Promise((resolve, reject) => {
      const opts = {
        hostname: u.hostname,
        path: u.pathname + u.search,
        method: 'GET',
        headers: { 'Cache-Control': 'no-cache, no-store, must-revalidate' },
        timeout: 15000,
      };
      const req = https.request(opts, (res) => {
        let d = '';
        res.on('data', c => d += c);
        res.on('end', () => {
          resolve({
            status: res.statusCode,
            cache: res.headers['cf-cache-status'],
            contentLength: res.headers['content-length'],
            contentType: res.headers['content-type'],
            body: d,
          });
        });
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
      req.end();
    });
    
    const hasHTML = /\<html|\<!DOCTYPE/i.test(resp.body);
    const hasScript = /\<script/i.test(resp.body);
    const hasLoading = /加载|loading|spinner/i.test(resp.body);
    
    console.log('Status:', resp.status);
    console.log('CF-Cache:', resp.cache || 'NONE');
    console.log('Content-Type:', resp.contentType || '(none)');
    console.log('Body length:', resp.body.length);
    console.log('Has HTML:', hasHTML, '| Script:', hasScript, '| Loading:', hasLoading);
    
    if (resp.body.length > 0 && resp.body.length < 500) {
      console.log('Body:', resp.body);
    }
  }
  
  console.log('\n=== DONE ===');
}

main();