import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = path => readFileSync(path, 'utf8');
const workerEntry = read('src/worker-entry.ts');
const workerFinal = read('src/worker-final.ts');
const operatorPolicy = read('src/security/operatorPolicy.ts');
const chatRoom = read('src/durable-objects/ChatRoom.ts');
const mobileShell = read('src/admin/AdminMobileShell.tsx');
const desktopShell = read('src/admin/DesktopAdminPolish.tsx');
const invitePanel = read('src/admin/InviteLinkPanel.tsx');
const riskCenter = read('src/admin/AdminRiskCenter.tsx');

test('ordinary operator risk controls are enforced through the centralized fail-closed policy boundary', () => {
  assert.match(operatorPolicy, /operator_policy:/);
  assert.match(operatorPolicy, /DENY_OPERATOR_POLICY/);
  assert.match(operatorPolicy, /canCreateInvites/);
  assert.match(operatorPolicy, /canUseStaffChat/);
  assert.match(operatorPolicy, /canUploadImages/);
  assert.match(workerEntry, /operator_permission_denied/);
  assert.match(workerEntry, /readPolicy\(env\.DB/);
  assert.match(workerFinal, /\/api\/ws\/staff/);
  assert.match(workerFinal, /readOperatorPolicy/);
  assert.match(workerFinal, /withStaffRoomAccess/);
});

test('new super-admin control mutations have an outer request-size boundary', () => {
  assert.match(workerFinal, /ADMIN_CONTROL_JSON_MAX_BYTES/);
  assert.match(workerFinal, /requestStreamExceeds/);
  assert.match(workerFinal, /operator-policies/);
  assert.match(workerFinal, /reset-password/);
  assert.match(workerFinal, /request_too_large/);
});

test('established staff sockets are revalidated against current session and capability on every staff broadcast', () => {
  assert.match(chatRoom, /mode: 'staff'/);
  assert.match(chatRoom, /CHAT_ROOM_STAFF_BROADCAST_HEADER/);
  assert.match(chatRoom, /canReceiveStaff/);
  assert.match(chatRoom, /auth\.revoked_at IS NULL/);
  assert.match(chatRoom, /canUseStaffChat/);
  assert.match(chatRoom, /Staff access revoked/);
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

test('mobile and desktop root navigation use workspace state and no DOM inference', () => {
  for (const shell of [mobileShell, desktopShell]) {
    assert.equal(shell.includes('MutationObserver'), false);
    assert.equal(shell.includes('admin-staff-view'), false);
    assert.equal(shell.includes('querySelector'), false);
    assert.match(shell, /useAdminWorkspace/);
    assert.match(shell, /openView\(/);
  }
});

test('QR editor exposes four presets and edits text directly on the preview', () => {
  for (const label of ['亮绿', '亮橙', '亮蓝', '亮黄']) assert.ok(invitePanel.includes(label));
  assert.match(invitePanel, /qr-direct-top/);
  assert.match(invitePanel, /qr-direct-bottom/);
  assert.match(invitePanel, /先看版式，生成后自动填入二维码/);
});

test('risk center provides single-session logout, password reset and capability scheduling', () => {
  assert.match(riskCenter, /踢出当前登录/);
  assert.match(riskCenter, /重置密码/);
  assert.match(riskCenter, /生成邀请二维码/);
  assert.match(riskCenter, /使用内部消息/);
  assert.match(riskCenter, /向客户上传图片/);
});
