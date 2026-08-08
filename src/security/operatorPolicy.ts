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

type PolicyRow = { value_json: string };

export function operatorPolicyKey(adminId: string) {
  return `operator_policy:${adminId}`;
}

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

export function parseStoredOperatorPolicy(valueJson: string | null | undefined): OperatorPolicy {
  if (!valueJson) return { ...DENY_OPERATOR_POLICY };
  try {
    return normalizeOperatorPolicy(JSON.parse(valueJson));
  } catch {
    return { ...DENY_OPERATOR_POLICY };
  }
}

export async function readOperatorPolicy(db: D1Database, adminId: string) {
  const row = await db.prepare('SELECT value_json FROM settings WHERE key=? LIMIT 1')
    .bind(operatorPolicyKey(adminId))
    .first<PolicyRow>();
  return parseStoredOperatorPolicy(row?.value_json);
}

export async function writeOperatorPolicy(db: D1Database, adminId: string, policy: OperatorPolicy) {
  const normalized = normalizeOperatorPolicy(policy);
  await db.prepare(
    `INSERT INTO settings(key,value_json,updated_at) VALUES(?,?,?)
      ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at`,
  ).bind(operatorPolicyKey(adminId), JSON.stringify(normalized), new Date().toISOString()).run();
  return normalized;
}
