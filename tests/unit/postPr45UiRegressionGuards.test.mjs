import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = path => readFile(new URL(`../../${path}`, import.meta.url), 'utf8');

test('admin shells resync authenticated identity after login without coupling role to capabilities', async () => {
  for (const path of ['src/admin/AdminMobileShell.tsx', 'src/admin/DesktopAdminPolish.tsx']) {
    const source = await read(path);
    assert.doesNotMatch(source, /Promise\.all\(\s*\[\s*apiFetch<AuthResponse>[\s\S]*?apiFetch<CapabilityResponse>/);
    assert.match(source, /const refreshIdentity = useCallback/);
    assert.match(source, /apiFetch<AuthResponse>\('\/api\/auth\/me'/);
    assert.match(source, /setRole\(nextRole\)/);
    assert.match(source, /if \(nextRole === 'SUPER_ADMIN'\)/);
    assert.match(source, /setCanCreateInvites\(true\)/);
    assert.match(source, /setCanUseStaffChat\(true\)/);
    assert.match(source, /if \(role\) return;[\s\S]*?setInterval\(\(\) => \{ void refreshIdentity\(\); \}, 1000\)/);
    assert.match(source, /apiFetch<CapabilityResponse>\('\/api\/admin\/capabilities'/);
  }
});

test('unresolved admin role is never mislabeled as customer-service operator', async () => {
  const source = await read('src/admin/OperatorProfileSettings.tsx');
  assert.match(source, /role === 'SUPER_ADMIN' \? '超级管理员' : role === 'OPERATOR' \? '客服' : '身份加载中'/);
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

test('desktop settings secondary pane and customer details use deterministic top-aligned geometry', async () => {
  const css = await read('src/admin/adminRegressionFixes.css');
  assert.match(css, /\.desktop-settings-nav\{[^}]*left:72px;width:288px/);
  assert.match(css, /\.desktop-settings-content\{left:360px\}/);
  assert.match(css, /grid-template-columns:360px minmax\(0,1fr\)/);
  assert.match(css, /\.session-action-bar\{justify-content:flex-start!important;align-content:flex-start!important\}/);
  assert.match(css, />\.customer-remark-form\{order:2!important;[^}]*width:100%/);
  assert.match(css, />\.session-client-info\{order:4/);
});

test('profile name remains an inline click-to-edit control', async () => {
  const source = await read('src/admin/OperatorProfileSettings.tsx');
  assert.match(source, /className="account-display-name-view" onClick=\{beginNameEdit\}/);
  assert.match(source, /method: 'PATCH'/);
  assert.match(source, /JSON\.stringify\(\{ displayName \}\)/);
});
