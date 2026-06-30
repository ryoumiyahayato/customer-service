import https from 'https';

const t = Date.now();
const urls = [
  { name: 'root /', url: 'https://vx9qn7zr.org/' },
  { name: 'root /?t=ts', url: 'https://vx9qn7zr.org/?t=' + t },
  { name: '40hex /', url: 'https://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.vx9qn7zr.org/' },
  { name: '40hex /?t=ts', url: 'https://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.vx9qn7zr.org/?t=' + t },
  { name: 'abc /', url: 'https://abc.vx9qn7zr.org/' },
  { name: 'bad_token /', url: 'https://bad_token.vx9qn7zr.org/' },
  { name: 'api/auth/me', url: 'https://vx9qn7zr.org/api/auth/me' },
  { name: 'abc/api/auth', url: 'https://abc.vx9qn7zr.org/api/auth/me' },
  { name: '40hex/api/auth', url: 'https://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.vx9qn7zr.org/api/auth/me' },
];

async function doGet(url) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    // Add cache buster
    u.searchParams.set('_cb', Date.now() + '_' + Math.random().toString(36).slice(2, 6));
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
          cache: res.headers['cf-cache-status'] || 'NONE',
          contentLength: res.headers['content-length'],
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
  const results = [];
  for (const item of urls) {
    console.log('Testing:', item.name);
    try {
      const resp = await doGet(item.url);
      const hasHtml = /\<html|\<!DOCTYPE/i.test(resp.body);
      const hasScript = /\<script/i.test(resp.body);
      const hasLoading = /加载|loading|spinner/i.test(resp.body);
      const hasVite = /vite/i.test(resp.body);
      
      results.push({
        name: item.name,
        status: resp.status,
        cache: resp.cache,
        len: resp.body.length,
        html: hasHtml,
        script: hasScript,
        loading: hasLoading,
        vite: hasVite,
        snippet: resp.body.substring(0, 120).replace(/\n/g, '\\n').replace(/\r/g, ''),
      });
      
      console.log('  Status:', resp.status, '| Cache:', resp.cache, '| Length:', resp.body.length, '| HTML:', hasHtml);
    } catch (e) {
      results.push({ name: item.name, status: 'ERR:' + e.message, len: 0, html: false, script: false, loading: false, vite: false });
      console.log('  ERROR:', e.message);
    }
  }
  
  console.log('\n========== RESULTS ==========');
  console.log('%-22s | Status | Cache   | Len   | HTML | Script | Loading | Snippet', 'Test');
  console.log('-'.repeat(120));
  for (const r of results) {
    const pass = r.status === 404 || r.status === 410;
    console.log(
      '%-22s | %-6s | %-5s  | %4d  | %-4s | %-6s | %-7s | %s',
      r.name,
      r.status,
      r.cache,
      r.len,
      r.html ? 'YES!' : 'no',
      r.script ? 'YES!' : 'no',
      r.loading ? 'YES!' : 'no',
      r.snippet
    );
  }
  
  console.log('\n=== Summary ===');
  const allNonHtml = results.every((r) => !r.html);
  const allNonScript = results.every((r) => !r.script);
  const all404or410 = results.every((r) => typeof r.status === 'number' && (r.status === 404 || r.status === 410));
  const noLoading = results.every((r) => !r.loading);
  console.log('All 404/410:', all404or410 ? 'YES ✓' : 'NO ✗');
  console.log('No HTML:', allNonHtml ? 'YES ✓' : 'NO ✗');
  console.log('No Script:', allNonScript ? 'YES ✓' : 'NO ✗');
  console.log('No Loading:', noLoading ? 'YES ✓' : 'NO ✗');
  
  // Write to file
  const fs = await import('fs');
  fs.writeFileSync('test_results.txt', JSON.stringify(results, null, 2));
  console.log('\nResults written to test_results.txt');
}

main();