import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = path => readFileSync(path, 'utf8');

test('legacy QR panel is not allowed to render inside the message sidebar', () => {
  const desktop = read('src/admin/desktopAdminPolish.css');
  const mobile = read('src/admin/adminMobileShell.css');
  assert.match(desktop, /side\.desktop-side>\.qr-only-panel\{display:none!important\}/);
  assert.match(mobile, /side\.desktop-side>\.qr-only-panel\{display:none!important\}/);
});

test('desktop internal staff composer fills the available chat width', () => {
  const css = read('src/admin/desktopAdminPolish.css');
  assert.match(css, /chat-panel>\.composer\{[\s\S]*width:100%/);
  assert.match(css, /chat-panel>\.staff-composer\{[\s\S]*grid-template-columns:minmax\(0,1fr\) 96px!important/);
  assert.match(css, /desktop-admin-settings-legacy[\s\S]*\.staff-composer\{width:100%;align-self:stretch\}/);
});

test('desktop QR secondary pane stays inside the dedicated QR workspace', () => {
  const css = read('src/admin/desktopAdminPolish.css');
  assert.match(css, /desktop-qr-overlay \.invite-workspace-shell\{[\s\S]*position:absolute!important/);
  assert.match(css, /grid-template-columns:340px minmax\(0,1fr\)!important/);
  assert.match(css, /invite-workspace-editor\{display:block;min-width:0/);
});

test('QR card text is bounded and exported with adaptive font sizing plus a hard canvas width cap', () => {
  const presentation = read('src/operatorPresentation.ts');
  const editor = read('src/admin/InviteLinkPanel.tsx');
  const qr = read('src/admin/inviteQr.ts');
  assert.match(presentation, /QR_CARD_TEXT_MAX_LENGTH = 18/);
  assert.match(presentation, /qrTopText: cleanText\(source\.qrTopText, QR_CARD_TEXT_MAX_LENGTH/);
  assert.match(presentation, /qrBottomText: cleanText\(source\.qrBottomText, QR_CARD_TEXT_MAX_LENGTH/);
  assert.match(editor, /maxLength=\{QR_CARD_TEXT_MAX_LENGTH\}/);
  assert.match(qr, /fontSize = 24/);
  assert.match(qr, /fontSize -= 1/);
  assert.match(qr, /fontSize > 16/);
  assert.match(qr, /fillText\(value, width \/ 2, y, maxWidth\)/);
  assert.doesNotMatch(qr, /shown\.slice|shown !== value/);
});

test('QR direct-edit text centers match the exported top and bottom bands', () => {
  const css = read('src/admin/qrComposer.css');
  assert.match(css, /qr-direct-top\{top:8\.45%/);
  assert.match(css, /qr-direct-bottom\{top:92\.75%;bottom:auto/);
  assert.match(css, /transform:translateY\(-50%\)/);
});

test('mobile bottom navigation uses fixed icon and label rows', () => {
  const css = read('src/admin/adminMobileShell.css');
  assert.match(css, /grid-template-rows:24px 14px/);
  assert.match(css, /mobile-bottom-nav span\{display:block;width:100%;height:14px/);
  assert.match(css, /line-height:14px/);
});
