import https from 'https';

const TOKEN = 'cfoat_W3nmL57TgaKRsbi32935nfd2StO3d5cxUJ8IItA4CHI.SsRv2HlpzGRd8eafHRIXEyJQxpi8M43e3VMZIboTCR8';
const ZONE_NAME = 'vx9qn7zr.org';

function api(path, method = 'GET', body = null) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: 'api.cloudflare.com',
      path: '/client/v4/' + path.replace(/^\/+/, ''),
      method,
      headers: {
        'Authorization': `Bearer ${TOKEN}`,
        'Content-Type': 'application/json',
      },
    };
    const req = https.request(opts, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch {
          resolve({ raw: data });
        }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function main() {
  // 1. Get zone ID
  const zones = await api(`zones?name=${ZONE_NAME}`);
  if (!zones.success || !zones.result.length) {
    console.log('Failed to get zone:', JSON.stringify(zones));
    return;
  }
  const zoneId = zones.result[0].id;
  console.log(`Zone ID: ${zoneId}`);

  // 2. Purge entire cache for the zone
  console.log('\nPurging cache for zone...');
  const purge = await api(`zones/${zoneId}/purge_cache`, 'POST', { purge_everything: true });
  console.log('Purge result:', JSON.stringify(purge));

  // 3. Also try to find the Worker
  const workers = await api(`accounts/6709e4edab972e57adc266d3b286a024/workers/scripts`);
  console.log('\nWorkers:', JSON.stringify(workers).substring(0, 200));

  // 4. Get Worker routes
  const routes = await api(`zones/${zoneId}/workers/routes`);
  console.log('\nRoutes:', JSON.stringify(routes).substring(0, 300));
}

main();