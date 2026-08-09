import assert from 'node:assert/strict';
import test from 'node:test';
import { registerTypeScriptHooks } from '../helpers/tsExtensionLoader.mjs';

registerTypeScriptHooks();
const { apiRateLimitBucket } = await import('../../src/runtimeWorker.ts');
const { boundedRateLimitKey } = await import('../../src/security/resourceLimits.ts');

test('semantic rate-limit buckets do not grow with arbitrary API paths or session ids', () => {
  const mutationBuckets = new Set();
  const mutationKeys = new Set();
  for (let index = 0; index < 1000; index += 1) {
    const path = `/api/abc${index}`;
    const request = new Request(`https://admin.example.test${path}`, { method: 'POST' });
    const bucket = apiRateLimitBucket(request);
    mutationBuckets.add(bucket);
    mutationKeys.add(boundedRateLimitKey(bucket, '198.51.100.10'));
  }
  for (let index = 0; index < 1000; index += 1) {
    const request = new Request(`https://admin.example.test/api/sessions/${index}/messages`, { method: 'POST' });
    mutationKeys.add(boundedRateLimitKey(apiRateLimitBucket(request), '198.51.100.10'));
  }
  assert.deepEqual([...mutationBuckets], ['api-mutation']);
  assert.equal(mutationKeys.size, 1);
});
