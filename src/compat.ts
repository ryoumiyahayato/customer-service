export function safeRandomId(prefix = 'id') {
  const c = globalThis.crypto as Crypto | undefined;
  if (c && typeof c.randomUUID === 'function') {
    return `${prefix}_${c.randomUUID().replace(/-/g, '').slice(0, 24)}`;
  }
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export function getErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string') return error;
  return '未知错误';
}

export function copyText(text: string) {
  if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    return navigator.clipboard.writeText(text);
  }
  return Promise.reject(new Error('当前浏览器不支持复制，请长按选择错误信息后手动复制'));
}

export function isWebSocketSupported() {
  return typeof WebSocket !== 'undefined';
}

export function isAbortControllerSupported() {
  return typeof AbortController !== 'undefined';
}

export function isAbortError(error: unknown): boolean {
  if (error instanceof DOMException && error.name === 'AbortError') return true;
  if (error instanceof Error && (error.name === 'AbortError' || error.message?.includes('aborted'))) return true;
  return false;
}

export function isExpectedError(error: unknown): boolean {
  if (isAbortError(error)) return true;
  if (error instanceof TypeError && error.message?.includes('fetch')) return true;
  if (error instanceof Event && error.type === 'close') return true;
  const msg = typeof error === 'string' ? error : (error instanceof Error ? (error.name + ': ' + error.message) : '');
  return /signal is aborted|aborted without reason|networkerror|failed to fetch|request canceled|request cancelled/i.test(msg);
}
