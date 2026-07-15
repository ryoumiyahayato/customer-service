#!/usr/bin/env node

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../deploy/android-shell/app/src/', import.meta.url);
const read = (relative) => readFile(new URL(relative, root), 'utf8');
const [security, activity, mainNetwork, debugNetwork, manifest] = await Promise.all([
  read('main/java/net/customerchat/app/WebViewSecurity.kt'),
  read('main/java/net/customerchat/app/MainActivity.kt'),
  read('main/res/xml/network_security_config.xml'),
  read('debug/res/xml/network_security_config.xml'),
  read('main/AndroidManifest.xml'),
]);

assert.match(security, /sameOrigin\(uri, admin\)/);
assert.match(security, /host\.endsWith\("\.\$visitorHost"\)/);
assert.match(security, /scheme != "https"/);
assert.match(security, /developmentHosts/);
assert.match(security, /uri\.userInfo != null \|\| uri\.fragment != null/);
assert.doesNotMatch(security, /return scheme == "https" \|\| scheme == "http"/);
assert.match(security, /\?\[REDACTED\]/);

assert.match(activity, /MIXED_CONTENT_NEVER_ALLOW/);
assert.match(activity, /javaScriptCanOpenWindowsAutomatically = false/);
assert.match(activity, /setSupportMultipleWindows\(false\)/);
assert.match(activity, /BuildConfig\.DEBUG/);
assert.match(activity, /startMode/);

assert.doesNotMatch(mainNetwork, /cleartextTrafficPermitted="true"/);
assert.match(debugNetwork, /10\.0\.2\.2/);
assert.match(manifest, /android:allowBackup="false"/);

console.log('android shell security checks passed');
