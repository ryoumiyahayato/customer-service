export type OperatorPresetMessageType = 'text' | 'image';

export type OperatorPresetMessageRow = {
  id: string;
  admin_id: string;
  position: number;
  message_type: OperatorPresetMessageType;
  content: string;
  image_object_key: string | null;
  image_mime_type: string | null;
  image_byte_size: number | null;
  created_at: string;
  updated_at: string;
};

export type OperatorPresetMessage = {
  id: string;
  position: number;
  messageType: OperatorPresetMessageType;
  content: string;
  imageObjectKey: string;
  imageMimeType: string;
  imageByteSize: number;
  createdAt: string;
  updatedAt: string;
};

export const PRESET_TEXT_MAX_LENGTH = 1000;
export const PRESET_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const PRESET_MESSAGE_MAX_ITEMS = 20;

export function toOperatorPresetMessage(row: OperatorPresetMessageRow): OperatorPresetMessage {
  return {
    id: row.id,
    position: Number(row.position || 0),
    messageType: row.message_type === 'image' ? 'image' : 'text',
    content: String(row.content || ''),
    imageObjectKey: String(row.image_object_key || ''),
    imageMimeType: String(row.image_mime_type || ''),
    imageByteSize: Number(row.image_byte_size || 0),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listOperatorPresetMessages(db: D1Database, adminId: string) {
  const rows = await db.prepare(
    `SELECT id,admin_id,position,message_type,content,image_object_key,image_mime_type,image_byte_size,created_at,updated_at
       FROM operator_preset_messages
      WHERE admin_id=?
      ORDER BY position ASC,datetime(created_at) ASC,id ASC`,
  ).bind(adminId).all<OperatorPresetMessageRow>();
  return (rows.results || []).map(toOperatorPresetMessage);
}

export async function countOperatorPresetMessages(db: D1Database, adminId: string) {
  const row = await db.prepare('SELECT COUNT(*) count FROM operator_preset_messages WHERE admin_id=?')
    .bind(adminId).first<{ count: number }>();
  return Number(row?.count || 0);
}

export async function nextOperatorPresetPosition(db: D1Database, adminId: string) {
  const row = await db.prepare('SELECT COALESCE(MAX(position),-1)+1 next_position FROM operator_preset_messages WHERE admin_id=?')
    .bind(adminId).first<{ next_position: number }>();
  return Math.max(0, Number(row?.next_position || 0));
}

export async function operatorPresetMessageById(db: D1Database, adminId: string, id: string) {
  const row = await db.prepare(
    `SELECT id,admin_id,position,message_type,content,image_object_key,image_mime_type,image_byte_size,created_at,updated_at
       FROM operator_preset_messages WHERE admin_id=? AND id=? LIMIT 1`,
  ).bind(adminId, id).first<OperatorPresetMessageRow>();
  return row ? toOperatorPresetMessage(row) : null;
}

export async function normalizeOperatorPresetPositions(db: D1Database, adminId: string, orderedIds?: string[]) {
  const current = await listOperatorPresetMessages(db, adminId);
  if (!orderedIds) {
    await db.batch(current.map((item, index) => db.prepare(
      'UPDATE operator_preset_messages SET position=?,updated_at=? WHERE admin_id=? AND id=?',
    ).bind(index, new Date().toISOString(), adminId, item.id)));
    return current.map((item, index) => ({ ...item, position: index }));
  }

  const unique = [...new Set(orderedIds.map(value => String(value || '').trim()).filter(Boolean))];
  if (unique.length !== current.length || unique.some(id => !current.some(item => item.id === id))) {
    throw new Error('invalid_preset_order');
  }
  const at = new Date().toISOString();
  await db.batch(unique.map((id, index) => db.prepare(
    'UPDATE operator_preset_messages SET position=?,updated_at=? WHERE admin_id=? AND id=?',
  ).bind(index, at, adminId, id)));
  return listOperatorPresetMessages(db, adminId);
}
