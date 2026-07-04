export function matchSessionMessages(pathname: string, prefix: '/api/visitor' | '/api/admin'): string | null {
  const match = new RegExp(`^${prefix}/sessions/([^/]+)/messages$`).exec(pathname);
  return match ? decodeURIComponent(match[1]) : null;
}

export function matchAdminSessionClose(pathname: string): string | null {
  const match = /^\/api\/admin\/sessions\/([^/]+)\/close$/.exec(pathname);
  return match ? decodeURIComponent(match[1]) : null;
}

export function matchAdminSessionAction(pathname: string): { sessionId: string; action: string } | null {
  const match = /^\/api\/admin\/sessions\/([^/]+)\/(archive|recycle|clear-history)$/.exec(pathname);
  return match ? { sessionId: decodeURIComponent(match[1]), action: match[2] } : null;
}

export function matchVisitorSessionAttachments(pathname: string): string | null {
  const match = /^\/api\/visitor\/sessions\/([^/]+)\/attachments$/.exec(pathname);
  return match ? decodeURIComponent(match[1]) : null;
}

export function matchVisitorAttachmentDownload(pathname: string): { sessionId: string; attachmentId: string } | null {
  const match = /^\/api\/visitor\/sessions\/([^/]+)\/attachments\/([^/]+)$/.exec(pathname);
  return match ? { sessionId: decodeURIComponent(match[1]), attachmentId: decodeURIComponent(match[2]) } : null;
}

export function matchAdminAttachmentDownload(pathname: string): string | null {
  const match = /^\/api\/admin\/attachments\/([^/]+)$/.exec(pathname);
  return match ? decodeURIComponent(match[1]) : null;
}

export function isSafeId(value: string): boolean {
  return /^[A-Za-z0-9_.:@-]+$/.test(value) && value.length <= 128;
}
