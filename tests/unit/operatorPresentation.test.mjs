import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_OPERATOR_PRESENTATION,
  QR_CARD_TEXT_MAX_LENGTH,
  normalizeOperatorPresentation,
  operatorPresentationKey,
} from '../../src/operatorPresentation.ts';

test('operator presentation uses a stable settings key', () => {
  assert.equal(operatorPresentationKey('admin_1'), 'operator_presentation:admin_1');
});

test('operator presentation normalizes editable fields', () => {
  const normalized = normalizeOperatorPresentation({
    welcomeText: '  您好，欢迎咨询  ',
    avatarKey: 'operator-avatars/admin_1/0123456789abcdef0123456789abcdef.webp',
    qrBackgroundColor: '#ABCDEF',
    qrAccentColor: '#12AB34',
    qrTopText: '  扫码联系客服  ',
    qrBottomText: '  一次性二维码  ',
  });
  assert.deepEqual(normalized, {
    welcomeText: '您好，欢迎咨询',
    avatarKey: 'operator-avatars/admin_1/0123456789abcdef0123456789abcdef.webp',
    qrBackgroundColor: '#abcdef',
    qrAccentColor: '#12ab34',
    qrTopText: '扫码联系客服',
    qrBottomText: '一次性二维码',
  });
});

test('QR card text is capped to the visual card capacity', () => {
  const long = '这是一个用于验证二维码卡片文字不会越过图片边界的超长文本';
  const normalized = normalizeOperatorPresentation({ qrTopText: long, qrBottomText: long });
  assert.equal(QR_CARD_TEXT_MAX_LENGTH, 18);
  assert.equal(normalized.qrTopText.length, QR_CARD_TEXT_MAX_LENGTH);
  assert.equal(normalized.qrBottomText.length, QR_CARD_TEXT_MAX_LENGTH);
});

test('operator presentation rejects unsafe avatar keys and invalid colors', () => {
  const normalized = normalizeOperatorPresentation({
    avatarKey: '../secret.png',
    qrBackgroundColor: 'red',
    qrAccentColor: 'rgb(1,2,3)',
  });
  assert.equal(normalized.avatarKey, '');
  assert.equal(normalized.qrBackgroundColor, DEFAULT_OPERATOR_PRESENTATION.qrBackgroundColor);
  assert.equal(normalized.qrAccentColor, DEFAULT_OPERATOR_PRESENTATION.qrAccentColor);
});