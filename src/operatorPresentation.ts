export type OperatorPresentation = {
  welcomeText: string;
  avatarKey: string;
  qrBackgroundColor: string;
  qrAccentColor: string;
  qrTopText: string;
  qrBottomText: string;
};

export const QR_CARD_TEXT_MAX_LENGTH = 18;

export const DEFAULT_OPERATOR_PRESENTATION: OperatorPresentation = {
  welcomeText: '您好，请问有什么可以帮您？',
  avatarKey: '',
  qrBackgroundColor: '#ffffff',
  qrAccentColor: '#18b868',
  qrTopText: '扫码联系客服',
  qrBottomText: '',
};

export function operatorPresentationKey(adminId: string) {
  return `operator_presentation:${adminId}`;
}

function cleanText(value: unknown, maxLength: number, fallback: string) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : fallback;
}

function cleanAvatarKey(value: unknown) {
  if (typeof value !== 'string') return '';
  const key = value.trim();
  return /^operator-avatars\/[a-zA-Z0-9_-]+\/[a-f0-9]{32}\.(?:jpg|png|webp)$/.test(key) ? key : '';
}

function cleanColor(value: unknown, fallback: string) {
  return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value)
    ? value.toLowerCase()
    : fallback;
}

export function normalizeOperatorPresentation(value: unknown): OperatorPresentation {
  const source = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  return {
    welcomeText: cleanText(source.welcomeText, 300, DEFAULT_OPERATOR_PRESENTATION.welcomeText),
    avatarKey: cleanAvatarKey(source.avatarKey),
    qrBackgroundColor: cleanColor(source.qrBackgroundColor, DEFAULT_OPERATOR_PRESENTATION.qrBackgroundColor),
    qrAccentColor: cleanColor(source.qrAccentColor, DEFAULT_OPERATOR_PRESENTATION.qrAccentColor),
    qrTopText: cleanText(source.qrTopText, QR_CARD_TEXT_MAX_LENGTH, DEFAULT_OPERATOR_PRESENTATION.qrTopText),
    qrBottomText: cleanText(source.qrBottomText, QR_CARD_TEXT_MAX_LENGTH, DEFAULT_OPERATOR_PRESENTATION.qrBottomText),
  };
}
