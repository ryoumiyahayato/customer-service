export function setActiveAdminSessionId(sessionId?: string | null) {
  if (typeof window === 'undefined') return;
  if (sessionId) {
    window.__supportActiveAdminSessionId = String(sessionId);
  } else {
    delete window.__supportActiveAdminSessionId;
  }
}

export function getActiveAdminSessionId() {
  if (typeof window === 'undefined') return '';
  return window.__supportActiveAdminSessionId || '';
}

export function messageBelongsToActiveSession(message: unknown, activeSessionId = getActiveAdminSessionId()) {
  if (!activeSessionId) return true;
  const item = message as { sessionId?: unknown } | null | undefined;
  const sessionId = String(item?.sessionId || '');
  return !sessionId || sessionId === activeSessionId;
}

declare global {
  interface Window {
    __supportActiveAdminSessionId?: string;
  }
}
