import { createHash } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { GenericServerConfig } from './config.js';
import { sendJson } from './response.js';

export type AbusePolicyName =
  | 'admin_login'
  | 'setup_initialize'
  | 'guest_bootstrap'
  | 'message_session'
  | 'message_ip'
  | 'upload';

export const ABUSE_POLICY_NAMES: AbusePolicyName[] = [
  'admin_login',
  'setup_initialize',
  'guest_bootstrap',
  'message_session',
  'message_ip',
  'upload',
];

type AbusePolicyRuntime = {
  limit: number;
  windowSeconds: number;
};

type Bucket = {
  count: number;
  resetAt: number;
};

export type AbuseDecision =
  | { allowed: true; policy: AbusePolicyName }
  | {
      allowed: false;
      policy: AbusePolicyName;
      retryAfterSeconds: number;
      ipFingerprint: string;
      keyFingerprint: string;
    };

export type AbuseGuard = {
  check: (request: IncomingMessage, policy: AbusePolicyName, rawParts?: Array<string | null | undefined>) => AbuseDecision;
  bucketCount: () => number;
};

export const DEFAULT_ABUSE_LIMITS = {
  adminLogin: { limit: 5, windowSeconds: 5 * 60 },
  setupInitialize: { limit: 5, windowSeconds: 10 * 60 },
  guestBootstrap: { limit: 30, windowSeconds: 10 * 60 },
  messageSession: { limit: 60, windowSeconds: 60 },
  messageIp: { limit: 180, windowSeconds: 60 },
  upload: { limit: 20, windowSeconds: 10 * 60 },
} as const;

const MAX_BUCKETS = 10000;
const SWEEP_INTERVAL_MS = 60 * 1000;

export function fingerprintSensitive(value: string | null | undefined): string {
  return createHash('sha256').update(String(value || '')).digest('base64url').slice(0, 18);
}

export function createAbuseKey(policy: AbusePolicyName, rawParts: string[]): string {
  const joined = rawParts.map((part) => String(part || '')).join('|');
  return `${policy}:${fingerprintSensitive(joined)}`;
}

export function abuseUsernamePart(body: Record<string, unknown>): string {
  const username = typeof body.username === 'string' ? body.username : '';
  return username.trim().toLowerCase().slice(0, 80) || 'missing_username';
}

export function abuseSessionPart(value: string | null | undefined): string {
  return String(value || '').trim().slice(0, 128) || 'missing_session';
}

export function getClientIp(request: IncomingMessage): string {
  return request.socket.remoteAddress || 'unknown';
}

function policyConfig(config: GenericServerConfig, policy: AbusePolicyName): AbusePolicyRuntime {
  const abuse = config.abuse;
  switch (policy) {
    case 'admin_login':
      return { limit: abuse.loginLimit, windowSeconds: abuse.loginWindowSeconds };
    case 'setup_initialize':
      return { limit: abuse.setupLimit, windowSeconds: abuse.setupWindowSeconds };
    case 'guest_bootstrap':
      return { limit: abuse.guestLimit, windowSeconds: abuse.guestWindowSeconds };
    case 'message_session':
      return { limit: abuse.messageLimit, windowSeconds: abuse.messageWindowSeconds };
    case 'message_ip':
      return { limit: abuse.messageIpLimit, windowSeconds: abuse.messageWindowSeconds };
    case 'upload':
      return { limit: abuse.uploadLimit, windowSeconds: abuse.uploadWindowSeconds };
  }
}

function pruneBuckets(buckets: Map<string, Bucket>, now: number) {
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }

  if (buckets.size <= MAX_BUCKETS) return;
  const overflow = buckets.size - MAX_BUCKETS;
  let removed = 0;
  for (const key of buckets.keys()) {
    buckets.delete(key);
    removed++;
    if (removed >= overflow) break;
  }
}

function logLimited(policy: AbusePolicyName, retryAfterSeconds: number, ipFingerprint: string, keyFingerprint: string) {
  console.warn(
    `abuse_guard limited route=${policy} retry_after=${retryAfterSeconds} ip_fp=${ipFingerprint} key_fp=${keyFingerprint}`,
  );
}

export function createAbuseGuard(config: GenericServerConfig): AbuseGuard {
  const buckets = new Map<string, Bucket>();
  let nextSweepAt = 0;

  return {
    check(request, policy, rawParts = []) {
      const now = Date.now();
      if (now >= nextSweepAt) {
        pruneBuckets(buckets, now);
        nextSweepAt = now + SWEEP_INTERVAL_MS;
      }

      const runtime = policyConfig(config, policy);
      const ip = getClientIp(request);
      const key = createAbuseKey(policy, [`ip:${ip}`, ...rawParts.map((part) => String(part || ''))]);
      const keyFingerprint = key.split(':')[1] || fingerprintSensitive(key);
      const ipFingerprint = fingerprintSensitive(ip);
      const windowMs = Math.max(1, runtime.windowSeconds) * 1000;
      let bucket = buckets.get(key);

      if (!bucket || bucket.resetAt <= now) {
        bucket = { count: 0, resetAt: now + windowMs };
        buckets.set(key, bucket);
      }

      if (bucket.count >= runtime.limit) {
        const retryAfterSeconds = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
        logLimited(policy, retryAfterSeconds, ipFingerprint, keyFingerprint);
        return { allowed: false, policy, retryAfterSeconds, ipFingerprint, keyFingerprint };
      }

      bucket.count += 1;
      return { allowed: true, policy };
    },
    bucketCount() {
      return buckets.size;
    },
  };
}

export function formatRateLimitResponse(decision: Extract<AbuseDecision, { allowed: false }>) {
  return {
    status: 429,
    body: { ok: false, error: 'rate_limited' },
    headers: { 'retry-after': String(decision.retryAfterSeconds) },
  };
}

export function sendRateLimitResponse(response: ServerResponse, decision: Extract<AbuseDecision, { allowed: false }>) {
  const payload = formatRateLimitResponse(decision);
  sendJson(response, payload.status, payload.body, payload.headers);
}

export function classifyAbuseRoute(method: string, pathname: string): AbusePolicyName[] {
  const verb = method.toUpperCase();
  if (verb !== 'POST') return [];

  if (pathname === '/api/auth/login' || pathname === '/api/admin/login') return ['admin_login'];
  if (pathname === '/api/setup/initialize') return ['setup_initialize'];
  if (/^\/api\/guest\/[^/]+$/.test(pathname)) return ['guest_bootstrap'];
  if (pathname === '/api/visitor/sessions') return ['guest_bootstrap'];
  if (pathname === '/api/messages') return ['message_ip', 'message_session'];
  if (pathname === '/api/upload') return ['upload'];
  if (/^\/api\/(visitor|admin)\/sessions\/[^/]+\/messages$/.test(pathname)) return ['message_ip', 'message_session'];
  if (/^\/api\/visitor\/sessions\/[^/]+\/attachments$/.test(pathname)) return ['upload'];

  return [];
}
