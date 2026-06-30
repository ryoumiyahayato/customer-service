import https from 'https';

function doGet(url) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: new URL(url).hostname,
      path: new URL(url).pathname + new URL(url).search,
      method: 'GET',
      headers: { 'Cache-Control': 'no-cache, no-store' },
      timeout: 15000,
    };
    const req = https.request(opts, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        resolve({
          status: res.statusCode,
          statusMessage: res.statusMessage,
          headers: res.headers,
          body: d,
        });
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.end();
  });
}

async function main() {
  const tests = [
    'https://vx9qn7zr.org/?t=a52',
    'https://abc.vx9qn7zr.org/?t=a52',
    'https://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.vx9qn7zr.org/?t=a52',
    'https://bad_token.vx9qn7zr.org/?t=a52',
  ];
  
  for (const testUrl of tests) {
    // Add unique cache buster
    const cacheBuster = Date.now() + '_' + Math.random().toString(36).slice(2);
    const url = testUrl + '&_cb=' + cacheBuster;
    console.log('=== Testing:', url, '===');
    try {
      const resp = await doGet(url);
      console.log('Status:', resp.status, resp.statusMessage);
      console.log('Content-Type:', resp.headers['content-type'] || '(none)');
      console.log('Content-Length:', resp.headers['content-length'] || '(none)');
      console.log('CF-Cache-Status:', resp.headers['cf-cache-status'] || '(none)');
      
      const body = resp.body;
      console.log('Body length:', body.length);
      console.log('Body preview:', body.substring(0, 300));
      
      const hasHtml = /\<html|\<!DOCTYPE/i.test(body);
      const hasScript = /\<script/i.test(body);
      const hasVite = /vite/i.test(body);
      const hasAssets = /assets/i.test(body);
      const hasLoading = /加载|loading|spinner/i.test(body);
      const hasBlue = /blue|background.*#/i.test(body);
      const hasReact = /react|React/i.test(body);
      
      console.log('Has HTML:', hasHtml, '| Script:', hasScript, '| Vite:', hasVite, '| Assets:', hasAssets);
      console.log('Has Loading:', hasLoading, '| Blue:', hasBlue, '| React:', hasReact);
      console.log('---');
    } catch (e) {
      console.log('ERROR:', e.message);
      console.log('---');
    }
  }
}

main();