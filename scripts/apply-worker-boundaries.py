#!/usr/bin/env python3
from __future__ import annotations

import re
from pathlib import Path

ROOT = Path.cwd()


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8-sig")


def write(path: str, content: str) -> None:
    target = ROOT / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content, encoding="utf-8")


def replace_required(source: str, old: str, new: str, label: str) -> str:
    if old not in source:
        raise RuntimeError(f"missing anchor: {label}")
    return source.replace(old, new, 1)


def regex_required(source: str, pattern: str, replacement: str, label: str) -> str:
    result, count = re.subn(pattern, replacement, source, count=1, flags=re.S)
    if count != 1:
        raise RuntimeError(f"missing regex anchor: {label}")
    return result


worker = read("src/worker.ts")
worker = replace_required(
    worker,
    "import { runLifecycle } from './sessionLifecycle';",
    "import { runLifecycle } from './sessionLifecycle';\n"
    "import { canSendMessage as canSendByState, isSessionEnded } from './domain/sessionState';\n"
    "import { DomainError } from './http/errors';\n"
    "import { SessionRepository } from './repositories/sessionRepository';\n"
    "import { MessageRepository } from './repositories/messageRepository';\n"
    "import { AttachmentRepository } from './repositories/attachmentRepository';\n"
    "import { SessionService, type SessionAction } from './services/sessionService';\n"
    "import { MessageService } from './services/messageService';\n"
    "import { AttachmentService } from './services/attachmentService';\n"
    "import { COOKIE_NAMES, clearSessionCookie, readCookie, serializeSessionCookie } from './security/cookies';\n"
    "import { constantTimeEqual, hmacHex, signValue, verifySignedValue } from './security/signing';\n"
    "import { hashSessionToken } from './security/sessionTokens';\n"
    "import { jsonResponse } from './security/responseHeaders';",
    "runtime imports",
)
worker = worker.replace("const ADMIN_COOKIE = 'support_admin';", "const ADMIN_COOKIE = COOKIE_NAMES.admin;")
worker = worker.replace("const VISITOR_COOKIE = 'visitor_account';", "const VISITOR_COOKIE = COOKIE_NAMES.visitor;")
worker = worker.replace("const GUEST_COOKIE = 'guest_session';", "const GUEST_COOKIE = COOKIE_NAMES.guest;")
worker = worker.replace("const HSTS_HEADER = 'max-age=31536000; includeSubDomains';\n", "")
worker = replace_required(
    worker,
    "const json = (body: unknown, init: ResponseInit = {}) => new Response(JSON.stringify(body), { ...init, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Strict-Transport-Security': HSTS_HEADER, ...(init.headers || {}) } });",
    "const json = jsonResponse;",
    "runtime json response",
)
worker = replace_required(
    worker,
    "const getCookie = (req: Request, name: string) => (req.headers.get('cookie') || '').split(';').map(x => x.trim()).find(x => x.startsWith(`${name}=`))?.slice(name.length + 1);\n"
    "const setCookie = (name: string, value: string) => `${name}=${value}; Path=/; Max-Age=86400; HttpOnly; SameSite=Lax; Secure`;\n"
    "const clearCookie = (name: string) => `${name}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax; Secure`;",
    "const getCookie = readCookie;\n"
    "const setCookie = serializeSessionCookie;\n"
    "const clearCookie = clearSessionCookie;",
    "runtime cookie delegates",
)
worker = regex_required(
    worker,
    r"async function hmac\(secret: string, value: string\) \{.*?\}\n"
    r"async function makeToken\(env: Env, value: string\) \{.*?\}\n"
    r"async function verifyToken\(env: Env, token\?: string\) \{.*?\}\n"
    r"async function tokenHash\(env: Env, value: string\) \{.*?\}",
    "async function hmac(secret: string, value: string) { return hmacHex(secret, value); }\n"
    "async function makeToken(env: Env, value: string) { return signValue(env.SESSION_SECRET, value); }\n"
    "async function verifyToken(env: Env, token?: string) { return verifySignedValue(env.SESSION_SECRET, token); }\n"
    "async function tokenHash(env: Env, value: string) { return hashSessionToken(env.SESSION_SECRET, value); }",
    "runtime signing delegates",
)
worker = regex_required(
    worker,
    r"function constantTimeEqual\(a: string, b: string\) \{.*?\}\n",
    "",
    "runtime duplicate constant-time comparison",
)
worker = replace_required(
    worker,
    "function sessionEnded(session?: SessionRecord | null) {\n"
    "  return Boolean(!session || session.deleted_at || session.purged_at || session.status === 'CLOSED' || session.status === 'ARCHIVED');\n"
    "}\n"
    "function canSendMessage(admin: Admin | null, session: SessionRecord | null) {\n"
    "  return canAccessSession(admin, session) && !sessionEnded(session);\n"
    "}",
    "function sessionEnded(session?: SessionRecord | null) {\n"
    "  return isSessionEnded(session);\n"
    "}\n"
    "function canSendMessage(admin: Admin | null, session: SessionRecord | null) {\n"
    "  return canAccessSession(admin, session) && canSendByState(session);\n"
    "}",
    "runtime lifecycle delegates",
)

new_create_message = r'''async function createMessage(req: Request, env: Env) {
  const body = await readJson(req);
  const admin = await currentAdmin(env, req);
  const senderType: 'VISITOR' | 'OPERATOR' =
    (body.senderType || (admin ? 'OPERATOR' : 'VISITOR')) === 'OPERATOR'
      ? 'OPERATOR'
      : 'VISITOR';
  let senderId = '';
  let sessionId = String(body.sessionId || '');
  let session: SessionRecord | null = null;

  if (senderType === 'OPERATOR') {
    if (!admin) return json({ error: ERR_LOGIN_REQUIRED }, { status: 401 });
    session = await getSessionById(env, sessionId);
    if (!session) return json({ error: ERR_SESSION_NOT_FOUND }, { status: 404 });
    if (!canAccessSession(admin, session)) return json({ error: ERR_NO_SESSION_ACCESS }, { status: 403 });
    if (!canSendMessage(admin, session)) return json({ error: ERR_SESSION_ENDED }, { status: 400 });
    senderId = admin.id;
  } else {
    const guest = await currentGuestSession(env, req);
    if (!guest) return invalidInvite();
    sessionId = sessionId || guest.session.id;
    session = await getSessionById(env, sessionId);
    if (!session || guest.session.id !== session.id || guest.user.id !== session.user_id) {
      return json({ error: ERR_NO_SESSION_ACCESS }, { status: 403 });
    }
    if (sessionEnded(session)) return json({ error: ERR_SESSION_ENDED }, { status: 400 });
    senderId = guest.visitorKey;
  }

  const rawClientId = typeof body.clientMessageId === 'string' ? body.clientMessageId.trim() : '';
  const clientMessageId = rawClientId ? rawClientId.slice(0, 120) : `server:${rid('cmid')}`;
  const service = new MessageService(new MessageRepository(env.DB), rid, now, attachmentKeyFromPath);
  const result = await service.create({
    sessionId,
    senderType,
    senderId,
    clientMessageId,
    content: String(body.content || ''),
    messageType: body.messageType === 'image' ? 'image' : 'text',
    imagePath: typeof body.imagePath === 'string' ? body.imagePath : null,
    quoteMessageId: typeof body.quoteMessageId === 'string' ? body.quoteMessageId : null,
  });
  if (result.deduped) {
    return json({ message: result.message, session: sessionForAudience(session, admin), deduped: true });
  }

  session = await getSessionById(env, sessionId);
  await broadcast(env, `conversation:${sessionId}`, {
    type: 'message:new',
    conversationId: sessionId,
    message: result.message,
    session: publicGuestSession(session),
  });
  await notifyAdmins(env);
  return json({ message: result.message, session: sessionForAudience(session, admin) });
}
'''
worker = regex_required(
    worker,
    r"async function createMessage\(req: Request, env: Env\) \{.*?\n\}\n(?=type SessionAction)",
    new_create_message,
    "message service extraction",
)

new_session_action = r'''async function sessionAction(req: Request, env: Env, sessionId: string, action: SessionAction) {
  const admin = await requireAdmin(env, req);
  const service = new SessionService(
    new SessionRepository(env.DB),
    (actor, session) => canManageSession(actor as Admin, session as SessionRecord),
  );
  try {
    const session = await service.execute(admin, sessionId, action, now());
    await broadcast(env, `conversation:${sessionId}`, {
      type: 'session:updated',
      conversationId: sessionId,
      session: publicGuestSession(session),
    });
    await notifyAdmins(env);
    return json({ ok: true, session });
  } catch (error) {
    if (!(error instanceof DomainError)) throw error;
    if (error.code === 'SESSION_NOT_FOUND') {
      return json({ error: ERR_SESSION_NOT_FOUND, code: error.code }, { status: error.status });
    }
    if (error.code === 'FORBIDDEN') {
      return json({ error: ERR_NO_SESSION_ACCESS, code: error.code }, { status: error.status });
    }
    return json({ error: ERR_SESSION_ENDED, code: error.code }, { status: error.status });
  }
}
'''
worker = regex_required(
    worker,
    r"type SessionAction = 'assign' \| 'close' \| 'archive' \| 'unarchive' \| 'delete' \| 'restore';\n\n"
    r"async function sessionAction\(req: Request, env: Env, sessionId: string, action: SessionAction\) \{.*?\n\}\n(?=async function bindGuest)",
    new_session_action,
    "session service extraction",
)

new_upload = r'''async function upload(req: Request, env: Env) {
  const url = new URL(req.url);
  const sessionId = String(url.searchParams.get('sessionId') || '');
  if (!sessionId) return json({ error: ERR_MISSING_SESSION }, { status: 400 });
  const session = await getSessionById(env, sessionId);
  if (!session) return json({ error: ERR_NO_SESSION_ACCESS }, { status: 403 });

  const admin = await currentAdmin(env, req);
  let createdByType: 'VISITOR' | 'OPERATOR' = 'VISITOR';
  let createdById = '';
  if (admin) {
    if (!canAccessSession(admin, session)) return json({ error: ERR_NO_SESSION_ACCESS }, { status: 403 });
    if (!canUploadAttachment(admin, session)) return json({ error: ERR_SESSION_ENDED }, { status: 400 });
    createdByType = 'OPERATOR';
    createdById = admin.id;
  } else {
    const guest = await currentGuestSession(env, req);
    if (!guest || guest.session.id !== session.id || guest.user.id !== session.user_id) {
      return json({ error: ERR_NO_SESSION_ACCESS }, { status: 403 });
    }
    if (sessionEnded(session)) return json({ error: ERR_SESSION_ENDED }, { status: 400 });
    createdById = guest.visitorKey;
  }

  const form = await req.formData();
  const file = form.get('file');
  if (!(file instanceof File)) return json({ error: ERR_PICK_IMAGE }, { status: 400 });
  const service = new AttachmentService(new AttachmentRepository(env.DB), env.UPLOADS, rid, now);
  try {
    return json(await service.upload({ sessionId, file, createdByType, createdById }));
  } catch (error) {
    if (!(error instanceof DomainError)) throw error;
    if (error.code === 'ATTACHMENT_INVALID_TYPE') return json({ error: ERR_IMAGE_TYPE }, { status: error.status });
    if (error.code === 'ATTACHMENT_TOO_LARGE') return json({ error: ERR_IMAGE_SIZE }, { status: error.status });
    throw error;
  }
}
'''
worker = regex_required(
    worker,
    r"async function upload\(req: Request, env: Env\) \{.*?\n\}(?=\nasync function api)",
    new_upload,
    "attachment service extraction",
)

write("src/runtimeWorker.ts", worker)
write(
    "src/worker.ts",
    "export { ChatRoom } from './runtimeWorker';\n"
    "export type { Env } from './runtimeWorker';\n"
    "export { default } from './runtimeWorker';\n",
)

for script_name in (
    "scripts/check-session-lifecycle.mjs",
    "scripts/check-high-risk-business-closures.mjs",
    "scripts/check-lifecycle-sql-boundaries.mjs",
    "scripts/check-obvious-code-issues.mjs",
):
    script_path = ROOT / script_name
    if script_path.exists():
        source = script_path.read_text(encoding="utf-8-sig")
        source = source.replace("'src/worker.ts'", "'src/runtimeWorker.ts'")
        source = source.replace('"src/worker.ts"', '"src/runtimeWorker.ts"')
        script_path.write_text(source, encoding="utf-8")

secure = read("src/worker-secure.ts")
secure = replace_required(
    secure,
    "import type { Env } from './worker';",
    "import type { Env } from './worker';\n"
    "import { COOKIE_NAMES, clearSessionCookie, readCookie } from './security/cookies';\n"
    "import { hmacHex, verifySignedValue } from './security/signing';\n"
    "import { hashSessionToken } from './security/sessionTokens';\n"
    "import { jsonResponse, withSecurityHeaders } from './security/responseHeaders';\n"
    "import { contentLengthExceeds, requestStreamExceeds } from './security/requestLimits';\n"
    "import { consumeRateLimit } from './security/rateLimit';",
    "secure wrapper imports",
)
secure = secure.replace("const ADMIN_COOKIE = 'support_admin';", "const ADMIN_COOKIE = COOKIE_NAMES.admin;")
secure = secure.replace("const VISITOR_COOKIE = 'visitor_account';", "const VISITOR_COOKIE = COOKIE_NAMES.visitor;")
secure = secure.replace("const GUEST_COOKIE = 'guest_session';", "const GUEST_COOKIE = COOKIE_NAMES.guest;")
secure = secure.replace("const enc = new TextEncoder();\n", "")
secure = regex_required(
    secure,
    r"const SECURITY_HEADERS = \{.*?\n\};\n\nfunction json\(body: unknown, init: ResponseInit = \{\}\) \{.*?\n\}\n\nfunction withSecurityHeaders\(response: Response\) \{.*?\n\}\n",
    "const json = jsonResponse;\n",
    "secure response primitives",
)
secure = regex_required(
    secure,
    r"async function requestStreamExceeds\(req: Request, maxBytes: number\) \{.*?\n\}\n\n"
    r"function contentLengthExceeds\(req: Request, maxBytes: number\) \{.*?\n\}\n",
    "",
    "secure request limit primitives",
)
secure = regex_required(
    secure,
    r"function getCookie\(req: Request, name: string\) \{.*?\n\}\n\n"
    r"function clearCookie\(name: string\) \{.*?\n\}\n\n"
    r"async function hmac\(secret: string, value: string\) \{.*?\n\}\n\n"
    r"function constantTimeEqual\(a: string, b: string\) \{.*?\n\}\n\n"
    r"async function verifySignedId\(env: Env, token\?: string\) \{.*?\n\}\n\n"
    r"async function tokenHash\(env: Env, value: string\) \{.*?\n\}\n",
    "const getCookie = readCookie;\n"
    "const clearCookie = clearSessionCookie;\n"
    "async function hmac(secret: string, value: string) { return hmacHex(secret, value); }\n"
    "async function verifySignedId(env: Env, token?: string) { return verifySignedValue(env.SESSION_SECRET, token); }\n"
    "async function tokenHash(env: Env, value: string) { return hashSessionToken(env.SESSION_SECRET, value); }\n",
    "secure cookie and signing primitives",
)
secure = regex_required(
    secure,
    r"async function consumeLimit\(env: Env, key: string, limit: number, windowMs: number\) \{.*?\n\}\n",
    "async function consumeLimit(env: Env, key: string, limit: number, windowMs: number) {\n"
    "  const retryAfter = await consumeRateLimit(env.DB, key, limit, windowMs);\n"
    "  return retryAfter === null\n"
    "    ? null\n"
    "    : json({ error: 'rate_limited' }, { status: 429, headers: { 'Retry-After': String(retryAfter) } });\n"
    "}\n",
    "secure rate limit primitive",
)
write("src/worker-secure.ts", secure)

business = read("src/worker-business-hardening.ts")
business = replace_required(
    business,
    "import type { Env } from './worker';",
    "import type { Env } from './worker';\n"
    "import { COOKIE_NAMES, readCookie } from './security/cookies';\n"
    "import { verifySignedValue } from './security/signing';\n"
    "import { hashSessionToken } from './security/sessionTokens';\n"
    "import { jsonResponse } from './security/responseHeaders';\n"
    "import { readJsonObjectWithinLimit } from './security/requestLimits';\n"
    "import { consumeRateLimit } from './security/rateLimit';",
    "business wrapper imports",
)
business = business.replace("const ADMIN_COOKIE = 'support_admin';", "const ADMIN_COOKIE = COOKIE_NAMES.admin;")
business = business.replace("const GUEST_COOKIE = 'guest_session';", "const GUEST_COOKIE = COOKIE_NAMES.guest;")
business = business.replace("const enc = new TextEncoder();\n", "")
business = regex_required(
    business,
    r"function json\(body: unknown, status = 200\) \{.*?\n\}\n",
    "function json(body: unknown, status = 200) { return jsonResponse(body, { status }); }\n",
    "business response primitive",
)
business = regex_required(
    business,
    r"function getCookie\(req: Request, name: string\) \{.*?\n\}\n\n"
    r"async function hmac\(secret: string, value: string\) \{.*?\n\}\n\n"
    r"async function verifySignedId\(env: Env, token\?: string\) \{.*?\n\}\n\n"
    r"async function tokenHash\(env: Env, value: string\) \{.*?\n\}\n",
    "const getCookie = readCookie;\n"
    "async function verifySignedId(env: Env, token?: string) { return verifySignedValue(env.SESSION_SECRET, token); }\n"
    "async function tokenHash(env: Env, value: string) { return hashSessionToken(env.SESSION_SECRET, value); }\n",
    "business cookie and signing primitives",
)
business = regex_required(
    business,
    r"function requestBodyTooLarge\(req: Request\) \{.*?\n\}\n\n"
    r"function jsonObject\(value: unknown\): Record<string, unknown> \{.*?\n\}\n\n"
    r"async function readJsonWithinLimit\(req: Request\): Promise<\{ body: Record<string, unknown>; tooLarge: boolean \}> \{.*?\n\}\n",
    "async function readJsonWithinLimit(req: Request) {\n"
    "  return readJsonObjectWithinLimit(req, JSON_REQUEST_MAX_BYTES);\n"
    "}\n",
    "business request limit primitives",
)
business = regex_required(
    business,
    r"async function mutationRateLimit\(env: Env, req: Request\) \{.*?\n\}\n",
    "async function mutationRateLimit(env: Env, req: Request) {\n"
    "  const ip = req.headers.get('cf-connecting-ip') || 'unknown';\n"
    "  const path = new URL(req.url).pathname;\n"
    "  const key = `hardening:${ip}:${path}`.slice(0, 240);\n"
    "  const retryAfter = await consumeRateLimit(env.DB, key, 20, 60 * 1000);\n"
    "  return retryAfter === null ? null : json({ error: 'rate_limited', retryAfter }, 429);\n"
    "}\n",
    "business rate limit primitive",
)
write("src/worker-business-hardening.ts", business)

print("worker boundaries extracted")
