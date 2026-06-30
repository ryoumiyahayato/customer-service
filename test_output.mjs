import https from 'https';
import fs from 'fs';

const urls = [
  'https://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.vx9qn7zr.org/?t=a52',
  'https://abc.vx9qn7zr.org/?t=a52',
  'https://bad_token.vx9qn7zr.org/?t=a52',
  'https://vx9qn7zr.org/',
  'https://cccccccccccccccccccccccccccccccccccccccc.vx9qn7zr.org/?t=a52-live'
];

function fetch(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'Cache-Control': 'no-cache' } }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data, url }));
    });
    req.on('error', reject);
    req.end();
  });
}

async function main() {
  const lines = [];
  for (const url of urls) {
    try {
      const result = await fetch(url);
      lines.push(`\n=== ${result.url} ===`);
      lines.push(`Status: ${result.status}`);
      lines.push(`CF-Cache: ${result.headers['cf-cache-status'] || 'N/A'}`);
      lines.push(`Content-Length: ${result.headers['content-length'] || 'N/A'}`);
      lines.push(`Body length: ${result.body.length}`);
      lines.push(`Body starts: ${result.body.substring(0, 80).replace(/\n/g, '\\n')}`);
      if (result.body.includes('<!doctype') || result.body.includes('<html') || result.body.includes('script') || result.body.includes('assets')) {
        lines.push('*** WARNING: STILL SERVING HTML/JS! ***');
      } else {
        lines.push('OK - no HTML/JS detected');
      }
    } catch (e) {
      lines.push(`\n=== ${url} ===`);
      lines.push(`ERROR: ${e.message}`);
    }
  }
  fs.writeFileSync('test_results.txt', lines.join('\n'));
  console.log('Results written to test_results.txt');
}

main();