import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = path => readFile(new URL(`../../${path}`, import.meta.url), 'utf8');

test('admin shells consume the single dashboard workspace instead of polling identity or clicking legacy DOM', async () => {
  for (const path of ['src/admin/AdminMobileShell.tsx', 'src/admin/DesktopAdminPolish.tsx']) {
    const source = await read(path);
    assert.match(source, /useAdminWorkspace/);
    assert.doesNotMatch(source, /\/api\/auth\/me|\/api\/admin\/capabilities/);
    assert.doesNotMatch(source, /buttonWithText|querySelector|MutationObserver|setInterval/);
    assert.match(source, /openView\(/);
    assert.match(source, /admin-unread-badge/);
  }
});

test('unresolved admin role is never mislabeled as customer-service operator', async () => {
  const source = await read('src/admin/OperatorProfileSettings.tsx');
  assert.match(source, /role === 'SUPER_ADMIN' \? '超级管理员' : role === 'OPERATOR' \? '客服' : '身份加载中'/);
});

test('super admin login username is a separate reauthenticated control', async () => {
  const source = await read('src/admin/OperatorProfileSettings.tsx');
  assert.match(source, /管理员登录账号/);
  assert.match(source, /只影响后台登录，不改变对外显示名称/);
  assert.match(source, /apiFetch\('\/api\/auth\/login'/);
  assert.match(source, /JSON\.stringify\(\{ username: nextUsername \}\)/);
});

test('production boundary enforces one active backend session and exposes device-only active sessions', async () => {
  const source = await read('src/worker-production-boundary.ts');
  assert.match(source, /FROM admin_active_sessions WHERE admin_id=\?/);
  assert.doesNotMatch(source, /admin_active_session:/);
  assert.match(source, /UPDATE admin_sessions SET revoked_at=COALESCE\(revoked_at,\?\) WHERE admin_id=\? AND id<>\?/);
  assert.match(source, /error: 'session_replaced'/);
  assert.match(source, /url\.pathname === '\/api\/admin\/security\/sessions'/);
  assert.match(source, /clientMetadataFromRequest/);
  const metadataWriter = source.match(/async function writeAdminSessionMetadata[\s\S]*?\n}/)?.[0] || '';
  assert.match(metadataWriter, /clientMetadataFromRequest/);
  assert.doesNotMatch(metadataWriter, /clientIp|cf-connecting-ip|x-forwarded-for/);
});

test('super admin staff clear control is rendered directly without DOM observers', async () => {
  const source = await read('src/admin/SuperAdminStaffClearControl.tsx');
  assert.match(source, /isSuper/);
  assert.match(source, /CLEAR_STAFF_CHAT/);
  assert.doesNotMatch(source, /MutationObserver|querySelector|admin-staff-view/);
});

test('expired visitor surface structurally hides stale presentation and sending state', async () => {
  const css = await read('src/visitor/visitorPresentation.css');
  assert.match(css, /:has\(\.link-expired-page\) \.operator-identity-overlay/);
  assert.match(css, /:has\(\.link-expired-page\) \.operator-welcome-overlay/);
  assert.match(css, /\.message-status\.sending/);
  assert.match(css, /\.sending-msg/);
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
  const css = await read('src/admin/adminWorkspace.css');
  assert.match(css, /\.desktop-settings-nav\{[^}]*left:72px;width:288px/);
  assert.match(css, /\.desktop-settings-content\{left:360px/);
  assert.match(css, /grid-template-columns:360px minmax\(0,1fr\)/);
  assert.match(css, /\.session-action-bar\{[^}]*justify-content:flex-start!important;align-content:flex-start!important/);
  assert.match(css, />\.customer-remark-form\{order:2!important;[^}]*width:100%/);
  assert.match(css, />\.session-client-info\{order:4/);
  assert.match(css, /\.desktop-settings-nav>button\{[^}]*align-items:flex-start!important/);
});

test('risk center is concise and shows active backend devices instead of raw security log cards', async () => {
  const source = await read('src/admin/AdminRiskCenter.tsx');
  assert.match(source, /<h4>客服权限<\/h4>/);
  assert.match(source, /<h4>后台登录设备<\/h4>/);
  assert.match(source, /\/api\/admin\/security\/sessions/);
  assert.doesNotMatch(source, /最近安全日志/);
  assert.doesNotMatch(source, /仅超级管理员可读/);
  assert.match(source, /generateTemporaryPassword/);
});

test('profile name remains an inline click-to-edit control', async () => {
  const source = await read('src/admin/OperatorProfileSettings.tsx');
  assert.match(source, /className="account-display-name-view" onClick=\{beginNameEdit\}/);
  assert.match(source, /method: 'PATCH'/);
  assert.match(source, /JSON\.stringify\(\{ displayName \}\)/);
});

test('unread state is derived by the dashboard and rendered directly in both navigation shells', async () => {
  const dashboard = await read('src/admin/AdminDashboard.tsx');
  const desktop = await read('src/admin/DesktopAdminPolish.tsx');
  const mobile = await read('src/admin/AdminMobileShell.tsx');
  const app = await read('src/apps/AdminApp.tsx');
  const polling = await read('src/chat/polling.ts');
  assert.match(dashboard, /const unreadCount = useMemo/);
  assert.match(dashboard, /sessionGroupOf\(s\) === 'active'/);
  assert.match(dashboard, /2500/);
  assert.match(desktop, /unreadCount/);
  assert.match(mobile, /unreadCount/);
  assert.doesNotMatch(app, /AdminUnreadBadge/);
  assert.match(polling, /800/);
  assert.match(polling, /1600/);
  assert.match(polling, /2500/);
});
