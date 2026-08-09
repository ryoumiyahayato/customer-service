/**
 * Resource limits are deliberately centralized so every write path and every
 * realtime path uses the same bounded values.  These are application safety
 * limits, not a replacement for edge/WAF policy.
 */
export const RESOURCE_LIMITS = {
  messagePageSize: 100,
  messageSessionMaxCount: 10_000,
  messageSessionMaxBytes: 20 * 1024 * 1024,
  unclaimedAttachmentMaxCount: 8,
  unclaimedAttachmentMaxBytes: 25 * 1024 * 1024,
  attachmentClaimTtlMs: 10 * 60 * 1000,
  websocket: {
    maxFrameBytes: 16 * 1024,
    maxConnectionsPerPrincipal: 4,
    maxConnectionsPerAuthSession: 2,
    maxConnectionsPerConversation: 2,
    maxConnectionsPerSharedRoom: 50,
    maxLifetimeMs: 24 * 60 * 60 * 1000,
    idleTimeoutMs: 15 * 60 * 1000,
    pingLimit: 20,
    pingWindowMs: 60 * 1000,
    upgradeLimit: 20,
    upgradeWindowMs: 60 * 1000,
  },
} as const;

export function boundedRateLimitKey(bucket: string, principal: string) {
  const safeBucket = bucket.replace(/[^A-Za-z0-9_.:-]/g, '_').slice(0, 80);
  const safePrincipal = principal.replace(/[^A-Za-z0-9_.:-]/g, '_').slice(0, 120);
  return `${safeBucket}:${safePrincipal}`;
}
