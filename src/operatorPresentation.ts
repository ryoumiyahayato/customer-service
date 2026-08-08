export type OperatorPresentation = {
  avatarKey: string;
  qrBackgroundColor: string;
  qrAccentColor: string;
  qrTopText: string;
  qrBottomText: string;
};

export const QR_CARD_TEXT_MAX_LENGTH = 18;

export const DEFAULT_OPERATOR_PRESENTATION: OperatorPresentation = {
  avatarKey: '',
  qrBackgroundColor: '#ffffff',
  qrAccentColor: '#18b868',
  qrTopText: '扫码联系客服',
  qrBottomText: '',
};

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
    avatarKey: cleanAvatarKey(source.avatarKey),
    qrBackgroundColor: cleanColor(source.qrBackgroundColor, DEFAULT_OPERATOR_PRESENTATION.qrBackgroundColor),
    qrAccentColor: cleanColor(source.qrAccentColor, DEFAULT_OPERATOR_PRESENTATION.qrAccentColor),
    qrTopText: cleanText(source.qrTopText, QR_CARD_TEXT_MAX_LENGTH, DEFAULT_OPERATOR_PRESENTATION.qrTopText),
    qrBottomText: cleanText(source.qrBottomText, QR_CARD_TEXT_MAX_LENGTH, DEFAULT_OPERATOR_PRESENTATION.qrBottomText),
  };
}

type PresentationRow = {
  avatar_key: string;
  qr_background_color: string;
  qr_accent_color: string;
  qr_top_text: string;
  qr_bottom_text: string;
};

export async function readOperatorPresentation(db: D1Database, adminId: string) {
  const row = await db.prepare(
    `SELECT avatar_key,qr_background_color,qr_accent_color,qr_top_text,qr_bottom_text
       FROM operator_presentations WHERE admin_id=? LIMIT 1`,
  ).bind(adminId).first<PresentationRow>();
  return normalizeOperatorPresentation(row ? {
    avatarKey: row.avatar_key,
    qrBackgroundColor: row.qr_background_color,
    qrAccentColor: row.qr_accent_color,
    qrTopText: row.qr_top_text,
    qrBottomText: row.qr_bottom_text,
  } : null);
}

export async function writeOperatorPresentation(db: D1Database, adminId: string, value: OperatorPresentation) {
  const normalized = normalizeOperatorPresentation(value);
  await db.prepare(
    `INSERT INTO operator_presentations(
       admin_id,welcome_text,avatar_key,qr_background_color,qr_accent_color,qr_top_text,qr_bottom_text,updated_at
     ) VALUES(?,'',?,?,?,?,?,?)
     ON CONFLICT(admin_id) DO UPDATE SET
       avatar_key=excluded.avatar_key,
       qr_background_color=excluded.qr_background_color,
       qr_accent_color=excluded.qr_accent_color,
       qr_top_text=excluded.qr_top_text,
       qr_bottom_text=excluded.qr_bottom_text,
       updated_at=excluded.updated_at`,
  ).bind(
    adminId,
    normalized.avatarKey,
    normalized.qrBackgroundColor,
    normalized.qrAccentColor,
    normalized.qrTopText,
    normalized.qrBottomText,
    new Date().toISOString(),
  ).run();
  return normalized;
}
