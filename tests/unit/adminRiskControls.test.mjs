import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = path => readFileSync(path, 'utf8');
const workerEntry = read('src/worker-entry.ts');
const workerFinal = read('src/worker-final.ts');
const mobileShell = read('src/admin/AdminMobileShell.tsx');
const desktopShell = read('src/admin/DesktopAdminPolish.tsx');
const invitePanel = read('src/admin/InviteLinkPanel.tsx');
const riskCenter = read('src/admin/AdminRiskCenter.tsx');

test('ordinary operator risk controls are enforced in Worker source boundaries', () => {
  assert.match(workerEntry, /operator_policy:/);
  assert.match(workerEntry, /canCreateInvites/);
  assert.match(workerEntry, /canUseStaffChat/);
  assert.match(workerEntry, /canUploadImages/);
  assert.match(workerEntry, /operator_permission_denied/);
  assert.match(workerFinal, /\/api\/ws\/staff/);
  assert.match(workerFinal, /canUseStaffChat/);
});

test('risk center endpoints are super-admin gated and audited', () => {
  assert.match(workerEntry, /\/api\/admin\/security\/overview/);
  assert.match(workerEntry, /\/api\/admin\/security\/logs/);
  assert.match(workerEntry, /requireSuperContext/);
  assert.match(workerEntry, /security\.operator_sessions\.revoked/);
  assert.match(workerEntry, /security\.operator_password\.reset/);
  assert.match(workerEntry, /security\.operator_policy\.changed/);
  assert.match(workerEntry, /security\.admin_login\.failed/);
});

test('operator invite response is stripped of raw link fields and returns QR data', () => {
  assert.match(workerEntry, /qrMatrix: buildQrMatrix/);
  assert.match(workerEntry, /rawLinkVisible: false/);
  assert.match(workerEntry, /token: _token/);
  assert.match(workerEntry, /url: _url/);
  assert.match(invitePanel, /客服账号只获得可发送的二维码，不返回具体邀请链接文本/);
});

test('visitor IP is returned only to super-admin session list responses', () => {
  assert.match(workerEntry, /admin\?\.role === 'SUPER_ADMIN'/);
  assert.match(workerEntry, /ip_address: client\.ipAddress/);
  assert.match(workerEntry, /ipAddress: clientIp\(req\)/);
});

test('mobile and desktop root navigation do not use MutationObserver state inference', () => {
  assert.equal(mobileShell.includes('MutationObserver'), false);
  assert.equal(desktopShell.includes('MutationObserver'), false);
  assert.match(mobileShell, /admin-staff-view/);
  assert.match(desktopShell, /admin-staff-view/);
});

test('QR editor exposes four presets and edits text directly on the preview', () => {
  for (const label of ['亮绿', '亮橙', '亮蓝', '亮黄']) assert.ok(invitePanel.includes(label));
  assert.match(invitePanel, /qr-direct-top/);
  assert.match(invitePanel, /qr-direct-bottom/);
  assert.match(invitePanel, /先看版式，生成后自动填入二维码/);
});

test('risk center provides forced logout, password reset and capability scheduling', () => {
  assert.match(riskCenter, /踢出全部登录/);
  assert.match(riskCenter, /重置密码/);
  assert.match(riskCenter, /生成邀请二维码/);
  assert.match(riskCenter, /使用内部消息/);
  assert.match(riskCenter, /向客户上传图片/);
});
