#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import process from 'node:process';

const VERIFY_BRANCH = 'ops/verify-production-assets-20260809';
if (process.env.WORKERS_CI !== '1' || String(process.env.WORKERS_CI_BRANCH || '') !== VERIFY_BRANCH) {
  process.exit(0);
}

function assetSet(html) {
  const matches = [...String(html).matchAll(/(?:src|href)=["'](\/assets\/[^"']+\.(?:js|css))["']/g)];
  return [...new Set(matches.map(match => match[1]))].sort();
}

const localHtml = await readFile(new URL('../dist/index.html', import.meta.url), 'utf8');
const localAssets = assetSet(localHtml);
if (!localAssets.length) {
  console.error('ERROR: Local build produced no admin JS/CSS assets to verify.');
  process.exit(1);
}

const url = `https://denglu.kefuxitong.net/?deployment_check=${Date.now()}`;
const response = await fetch(url, {
  headers: {
    'Cache-Control': 'no-cache',
    'Pragma': 'no-cache',
  },
  redirect: 'follow',
});
if (!response.ok) {
  console.error(`ERROR: Production admin root returned HTTP ${response.status}.`);
  process.exit(1);
}
const remoteHtml = await response.text();
const remoteAssets = assetSet(remoteHtml);

if (JSON.stringify(remoteAssets) !== JSON.stringify(localAssets)) {
  console.error(`ERROR: Production admin assets do not match current main build. Local=${JSON.stringify(localAssets)} Remote=${JSON.stringify(remoteAssets)}`);
  process.exit(1);
}

console.log(`Production admin assets match current main build: ${localAssets.join(', ')}`);
