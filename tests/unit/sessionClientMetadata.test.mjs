import assert from 'node:assert/strict';
import test from 'node:test';

import {
  approximateLocationFromCf,
  clientMetadataFromRequest,
  deviceLabelFromUserAgent,
  sessionClientMetadataKey,
} from '../../src/sessionClientMetadata.ts';

test('client metadata derives a compact device label without storing raw UA', () => {
  const ua = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 MicroMessenger/8.0.75';
  assert.equal(deviceLabelFromUserAgent(ua), 'iPhone · 微信 8.0.75');
});

test('location metadata is coarse and limited to city region country', () => {
  assert.equal(
    approximateLocationFromCf({ city: 'Chenzhou', region: 'Hunan', country: 'CN', postalCode: '424200' }),
    'Chenzhou · Hunan · CN',
  );
});

test('request metadata does not expose IP or raw user agent', () => {
  const request = new Request('https://example.test/', {
    headers: {
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/150.0.0.0',
      'cf-connecting-ip': '203.0.113.9',
    },
  });
  Object.defineProperty(request, 'cf', { value: { city: 'Tokyo', region: 'Tokyo', country: 'JP' } });
  const metadata = clientMetadataFromRequest(request, '2026-08-08T00:00:00.000Z');
  assert.equal(metadata.deviceLabel, 'Windows · Chrome 150.0.0.0');
  assert.equal(metadata.approximateLocation, 'Tokyo · JP');
  assert.equal(JSON.stringify(metadata).includes('203.0.113.9'), false);
  assert.equal(JSON.stringify(metadata).includes('Mozilla/5.0'), false);
  assert.equal(sessionClientMetadataKey('sess_1'), 'session_client_meta:sess_1');
});