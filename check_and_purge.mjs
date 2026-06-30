import https from 'https';

const CF_TOKEN = 'cfoat_W3nmL57TgaKRsbi32935nfd2StO3d5cxUJ8IItA4CHI.SsRv2HlpzGRd8eafHRIXEyJQxpi8M43e3VMZIboTCR8';
const CF_ACCOUNT = '6709e4edab972e57adc266d3b286a024';

function api(path, method = 'GET', body = null) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: 'api.cloudflare.com',
      path: `/client/v4${path}`,
      method,
      headers: {
        'Authorization': `Bearer ${CF_TOKEN}`,
        'Content-Type': 'application/json',
      },
    };
    const req = https.request(opts, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve(JSON.parse(d)); } catch { resolve({ success: false, raw: d }); }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function main() {
  // 1. List zones
  console.log('=== Listing zones ===');
  const zones = await api('/zones?name=vx9qn7zr.org');
  console.log('Zones result:', JSON.stringify(zones, null, 2));
  
  if (zones.success && zones.result.length > 0) {
    const zoneId = zones.result[0].id;
    console.log('\n=== Zone ID:', zoneId, '===');
    
    // 2. Get worker status
    console.log('\n=== Worker script info ===');
    const worker = await api(`/accounts/${CF_ACCOUNT}/workers/scripts/support-chat-cloudflare`);
    console.log('Worker:', JSON.stringify(worker, null, 2).substring(0, 500));
    
    // 3. Get worker routes
    console.log('\n=== Worker routes ===');
    const routes = await api(`/zones/${zoneId}/workers/routes`);
    console.log('Routes:', JSON.stringify(routes, null, 2));
    
    // 4. Purge cache
    console.log('\n=== Purging cache ===');
    const purgeResult = await api(`/zones/${zoneId}/purge_cache`, 'POST', { purge_everything: true });
    console.log('Purge result:', JSON.stringify(purgeResult, null, 2));
    
    // 5. List zone settings
    console.log('\n=== Zone cache settings ===');
    const cacheSettings = await api(`/zones/${zoneId}/settings/development_mode`);
    console.log('Dev mode:', JSON.stringify(cacheSettings, null, 2));
  }
}

main();