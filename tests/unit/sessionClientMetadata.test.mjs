import assert from 'node:assert/strict';
import test from 'node:test';

import {
  approximateLocationFromCf,
  clientMetadataFromRequest,
  deviceLabelFromUserAgent,
  sessionClientMetadataKey,
} from '../../src/sessionClientMetadata.ts';

test('client metadata derives a conservative device label without exposing app versions or raw UA', () => {
  const ua = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 MicroMessenger/8.0.75';
  assert.equal(deviceLabelFromUserAgent(ua), 'iPhone · 微信内置浏览器');
  assert.equal(deviceLabelFromUserAgent(ua).includes('8.0.75'), false);
});

test('mainland China location metadata is translated only from explicit known mappings', () => {
  assert.equal(
    approximateLocationFromCf({ city: 'Jiaxing', region: 'Zhejiang', country: 'CN', postalCode: '314000' }),
    '嘉兴市 · 浙江省 · 中国',
  );
  assert.equal(
    approximateLocationFromCf({ city: 'Unknown English City', region: 'Zhejiang', country: 'CN' }),
    '浙江省 · 中国',
  );
});

test('request metadata does not expose IP, raw user agent, or guessed foreign city names', () => {
  const request = new Request('https://example.test/', {
    headers: {
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/150.0.0.0',
      'cf-connecting-ip': '203.0.113.9',
    },
  });
  Object.defineProperty(request, 'cf', { value: { city: 'Tokyo', region: 'Tokyo', country: 'JP' } });
  const metadata = clientMetadataFromRequest(request, '2026-08-08T00:00:00.000Z');
  assert.equal(metadata.deviceLabel, 'Windows 电脑 · Chrome 浏览器');
  assert.equal(metadata.approximateLocation, '日本');
  assert.equal(JSON.stringify(metadata).includes('203.0.113.9'), false);
  assert.equal(JSON.stringify(metadata).includes('Mozilla/5.0'), false);
  assert.equal(JSON.stringify(metadata).includes('150.0.0.0'), false);
  assert.equal(sessionClientMetadataKey('sess_1'), 'session_client_meta:sess_1');
});
