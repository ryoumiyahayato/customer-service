import https from 'https';

const urls = [
  'https://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.vx9qn7zr.org/?t=a52',
  'https://abc.vx9qn7zr.org/?t=a52',
  'https://bad_token.vx9qn7zr.org/?t=a52',
  'https://cccccccccccccccccccccccccccccccccccccccc.vx9qn7zr.org/?t=a52-live'
];

function fetch(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'Cache-Control': 'no-cache' } }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    });
    req.on('error', reject);
    req.end();
  });
}

async function main() {
  for (const url of urls) {
    try {
      const result = await fetch(url);
      console.log(`\n=== ${url} ===`);
      console.log(`Status: ${result.status}`);
      console.log(`CF-Cache: ${result.headers['cf-cache-status'] || 'N/A'}`);
      console.log(`Content-Length: ${result.headers['content-length'] || 'N/A'}`);
      console.log(`Body length: ${result.body.length}`);
      console.log(`Body starts with: ${result.body.substring(0, 50).replace(/\n/g, '\\n')}`);
      if (result.body.includes('<!doctype') || result.body.includes('<html') || result.body.includes('script')) {
        console.log('*** STILL SERVING HTML! ***');
      } else {
        console.log('OK - no HTML detected');
      }
    } catch (e) {
      console.log(`\n=== ${url} ===`);
      console.log(`ERROR: ${e.message}`);
    }
  }
}

main();