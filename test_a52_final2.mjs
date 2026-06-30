import https from 'https';
import fs from 'fs';

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
let output = '';
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
        output += '\n=== Task 1 & 3: Invalid domains + API isolation ===\n\n';
        output += 'Test                 | Status | Cache   | Len   | HTML | API leak | Snippet\n';
        output += '-'.repeat(110) + '\n';
        results.forEach((r) => {
          const apiFail = r.api && r.status === 200;
          output +=
            r.name.padEnd(20) +
            ' | ' + String(r.status).padStart(3) +
            '    | ' + r.cache.padEnd(5) +
            '  | ' + String(r.len).padStart(4) +
            '  | ' + (r.html ? 'YES!' : 'no ') +
            ' | ' + (apiFail ? 'LEAK!' : 'ok   ') +
            ' | ' + r.snippet + '\n';
        });
        output += '\n=== Summary ===\n';
        output += 'All 404/410: '  + (results.every((r) => r.status === 404 || r.status === 410) ? 'YES ✓' : 'NO ✗') + '\n';
        output += 'No HTML:     '  + (results.every((r) => !r.html) ? 'YES ✓' : 'NO ✗') + '\n';
        output += 'No API leak: '  + (results.every((r) => !(r.api && r.status === 200)) ? 'YES ✓' : 'NO ✗') + '\n';
        fs.writeFileSync('C:\\Users\\agcrf\\Desktop\\learntest\\test_results_final.txt', output);
        console.log('Results written to test_results_final.txt');
        console.log(output);
        process.exit();
      }
    });
  }).end();
});