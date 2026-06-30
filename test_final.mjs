import https from 'https';
import fs from 'fs';

const t = Date.now();
const urls = [
  { name: 'root /', url: 'https://vx9qn7zr.org/' },
  { name: 'root /?t', url: 'https://vx9qn7zr.org/?t=' + t },
  { name: '40hex /', url: 'https://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.vx9qn7zr.org/' },
  { name: '40hex /?t', url: 'https://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.vx9qn7zr.org/?t=' + t },
  { name: 'abc /', url: 'https://abc.vx9qn7zr.org/' },
  { name: 'bad_token /', url: 'https://bad_token.vx9qn7zr.org/' },
  { name: 'api/auth/me', url: 'https://vx9qn7zr.org/api/auth/me' },
  { name: 'api/admin', url: 'https://vx9qn7zr.org/api/admin/sessions' },
  { name: 'api/operator', url: 'https://vx9qn7zr.org/api/operator/sessions' },
  { name: 'abc/api/auth', url: 'https://abc.vx9qn7zr.org/api/auth/me' },
  { name: '40hex/api/auth', url: 'https://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.vx9qn7zr.org/api/auth/me' },
];

let done = 0;
const lines = [];
urls.forEach((item) => {
  https.get(item.url, { headers: { 'Cache-Control': 'no-cache, no-store' } }, (res) => {
    let d = '';
    res.on('data', (c) => (d += c));
    res.on('end', () => {
      const hasHtml = /<!doctype|<html|<script|id="root"/i.test(d);
      const hasApi = /"admin"|"sessions"|"error"|Unauthorized/i.test(d);
      const apiFail = hasApi && res.statusCode === 200;
      lines.push([
        item.name,
        String(res.statusCode),
        res.headers['cf-cache-status'] || 'NONE',
        String(d.length),
        hasHtml ? 'YES' : 'no',
        apiFail ? 'LEAK' : 'ok',
        d.substring(0, 60).replace(/\n/g, '\\n')
      ].join('|').replace(/\r/g, ''));
      done++;
      if (done === urls.length) {
        let out = '\n=== Task 1 & 3: Invalid domains + API isolation ===\n\n';
        out += 'Test|Status|CF-Cache|Len|HTML|API|Snippet\n';
        out += lines.sort((a,b) => a.localeCompare(b)).join('\n') + '\n\n';
        out += 'Summary:\n';
        out += 'All 404/410: ' + (lines.every(l => /\|404\||\|410\|/.test(l) || l.startsWith('Test|')) ? 'YES' : 'CHECK LIST') + '\n';
        out += 'No HTML:     ' + (lines.every(l => !/\|YES\|/.test(l) || l.startsWith('Test|')) ? 'YES' : 'HAS HTML') + '\n';
        out += 'No API leak: ' + (lines.every(l => !/\|LEAK\|/.test(l) || l.startsWith('Test|')) ? 'YES' : 'HAS LEAK') + '\n';
        fs.writeFileSync('C:\\Users\\agcrf\\Desktop\\learntest\\test_final_out.txt', out);
        console.log('DONE - results written');
        process.exit(0);
      }
    });
  }).on('error', (e) => {
    lines.push([item.name, 'ERR', 'ERR', '0', 'no', 'ok', e.message].join('|'));
    done++;
    if (done === urls.length) process.exit(0);
  });
});