import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = path => readFile(new URL(`../../${path}`, import.meta.url), 'utf8');

test('admin shells do not couple authenticated role to capability fetch success', async () => {
  for (const path of ['src/admin/AdminMobileShell.tsx', 'src/admin/DesktopAdminPolish.tsx']) {
    const source = await read(path);
    assert.doesNotMatch(source, /Promise\.all\(\s*\[\s*apiFetch<AuthResponse>[\s\S]*?apiFetch<CapabilityResponse>/);
    assert.match(source, /apiFetch<AuthResponse>\('\/api\/auth\/me'/);
    assert.match(source, /apiFetch<CapabilityResponse>\('\/api\/admin\/capabilities'/);
    assert.match(source, /setRole\(nextRole\)/);
  }
});

test('super admin staff clear control follows the actual staff chat surface', async () => {
  const source = await read('src/admin/SuperAdminStaffClearControl.tsx');
  assert.match(source, /document\.querySelector\('\.staff-composer'\)/);
  assert.match(source, /new MutationObserver\(syncFromDom\)/);
  assert.match(source, /CLEAR_STAFF_CHAT/);
});

test('expired visitor surface structurally hides stale presentation', async () => {
  const css = await read('src/visitor/visitorPresentation.css');
  assert.match(css, /:has\(\.link-expired-page\) \.operator-identity-overlay/);
  assert.match(css, /:has\(\.link-expired-page\) \.operator-welcome-overlay/);
});

test('mobile QR editor exposes both text fields inside the bounded card', async () => {
  const component = await read('src/admin/InviteLinkPanel.tsx');
  const css = await read('src/admin/qrComposer.css');
  assert.match(component, /qr-direct-text qr-direct-top/);
  assert.match(component, /qr-direct-text qr-direct-bottom/);
  assert.match(css, /width:min\(100%,416px\)/);
  assert.match(css, /max-width:calc\(100vw - 28px\)/);
  assert.match(css, /\.qr-direct-top\{top:8\.45%!important/);
  assert.match(css, /\.qr-direct-bottom\{top:92\.75%!important/);
});

test('desktop settings secondary pane uses the same 360px boundary as conversations', async () => {
  const css = await read('src/admin/adminRegressionFixes.css');
  assert.match(css, /\.desktop-settings-nav\{[^}]*left:72px;width:288px/);
  assert.match(css, /\.desktop-settings-content\{left:360px\}/);
  assert.match(css, /grid-template-columns:360px minmax\(0,1fr\)/);
});

test('profile name remains an inline click-to-edit control', async () => {
  const source = await read('src/admin/OperatorProfileSettings.tsx');
  assert.match(source, /className="account-display-name-view" onClick=\{beginNameEdit\}/);
  assert.match(source, /method: 'PATCH'/);
  assert.match(source, /JSON\.stringify\(\{ displayName \}\)/);
});
