export type OperatorPolicy = {
  canCreateInvites: boolean;
  canUseStaffChat: boolean;
  canUploadImages: boolean;
};

export const DENY_OPERATOR_POLICY: Readonly<OperatorPolicy> = Object.freeze({
  canCreateInvites: false,
  canUseStaffChat: false,
  canUploadImages: false,
});

export const LEGACY_ENABLED_OPERATOR_POLICY: Readonly<OperatorPolicy> = Object.freeze({
  canCreateInvites: true,
  canUseStaffChat: true,
  canUploadImages: true,
});

type PolicyRow = {
  can_create_invites: number;
  can_use_staff_chat: number;
  can_upload_images: number;
};

export function normalizeOperatorPolicy(value: unknown): OperatorPolicy {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { ...DENY_OPERATOR_POLICY };
  const source = value as Record<string, unknown>;
  if (typeof source.canCreateInvites !== 'boolean'
    || typeof source.canUseStaffChat !== 'boolean'
    || typeof source.canUploadImages !== 'boolean') {
    return { ...DENY_OPERATOR_POLICY };
  }
  return {
    canCreateInvites: source.canCreateInvites,
    canUseStaffChat: source.canUseStaffChat,
    canUploadImages: source.canUploadImages,
  };
}

export async function readOperatorPolicy(db: D1Database, adminId: string) {
  const row = await db.prepare(
    `SELECT can_create_invites,can_use_staff_chat,can_upload_images
       FROM operator_policies WHERE admin_id=? LIMIT 1`,
  ).bind(adminId).first<PolicyRow>();
  if (!row) return { ...DENY_OPERATOR_POLICY };
  return {
    canCreateInvites: row.can_create_invites === 1,
    canUseStaffChat: row.can_use_staff_chat === 1,
    canUploadImages: row.can_upload_images === 1,
  };
}

export async function writeOperatorPolicy(db: D1Database, adminId: string, policy: OperatorPolicy) {
  const normalized = normalizeOperatorPolicy(policy);
  await db.prepare(
    `INSERT INTO operator_policies(admin_id,can_create_invites,can_use_staff_chat,can_upload_images,updated_at)
     VALUES(?,?,?,?,?)
     ON CONFLICT(admin_id) DO UPDATE SET
       can_create_invites=excluded.can_create_invites,
       can_use_staff_chat=excluded.can_use_staff_chat,
       can_upload_images=excluded.can_upload_images,
       updated_at=excluded.updated_at`,
  ).bind(
    adminId,
    normalized.canCreateInvites ? 1 : 0,
    normalized.canUseStaffChat ? 1 : 0,
    normalized.canUploadImages ? 1 : 0,
    new Date().toISOString(),
  ).run();
  return normalized;
}
