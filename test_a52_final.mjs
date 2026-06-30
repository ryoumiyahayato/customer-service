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
  { name: 'api/admin', url: 'https://vx9qn7zr.org/api/admin/sessions' },
  { name: 'api/operator', url: 'https://vx9qn7zr.org/api/operator/sessions' },
  { name: 'abc/api/auth', url: 'https://abc.vx9qn7zr.org/api/auth/me' },
  { name: '40hex/api/auth', url: 'https://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.vx9qn7zr.org/api/auth/me' },
];

let done = 0;
const results = [];
urls.forEach((item) => {
  https.get(item.url, { headers: { 'Cache-Control': 'no-cache, no-store' } }, (res) => {
    let d = '';
    res.on('data', (c) => (d += c));
    res.on('end', () => {
      const hasHtml = /<!doctype|<html|<script|id="root"/i.test(d);
      const hasApi = /"admin"|"sessions"|"error"|Unauthorized/i.test(d);
      results.push({
        name: item.name,
        status: res.statusCode,
        cache: res.headers['cf-cache-status'] || 'NONE',
        len: d.length,
        html: hasHtml,
        api: hasApi,
        snippet: d.substring(0, 80).replace(/\n/g, '\\n'),
      });
      done++;
      if (done === urls.length) {
        console.log('\n=== Task 1 & 3: Invalid domains + API isolation ===\n');
        console.log(
          '%-20s | Status | Cache   | Len   | HTML | API leak | Snippet',
          'Test'
        );
        console.log('-'.repeat(95));
        results.forEach((r) => {
          const pass = r.status === 404 || r.status === 410;
          const apiFail = r.api && r.status === 200;
          console.log(
            '%-20s | %3d    | %-5s  | %4d  | %-4s | %-8s | %s',
            r.name,
            r.status,
            r.cache,
            r.len,
            r.html ? 'YES!' : 'no',
            apiFail ? 'LEAK!' : 'ok',
            r.snippet
          );
        });
        console.log('\n=== Summary ===');
        const allNonHtml = results.every((r) => !r.html);
        const all404or410 = results.every((r) => r.status === 404 || r.status === 410);
        const noApiLeak = results.every((r) => !(r.api && r.status === 200));
        console.log('All 404/410:', all404or410 ? 'YES ✓' : 'NO ✗');
        console.log('No HTML:', allNonHtml ? 'YES ✓' : 'NO ✗');
        console.log('No API leak:', noApiLeak ? 'YES ✓' : 'NO ✗');
        process.exit();
      }
    });
  }).end();
});