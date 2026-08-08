import { isAbortControllerSupported, isAbortError } from '../compat';
import { normalizeApiPayload } from '../chat/mappers';

type ApiErrorData = Record<string, unknown> & { error?: string };
type ApiFetchOptions = RequestInit & { timeoutMs?: number; retryGet?: boolean };

export class ApiError extends Error {
  status: number;
  data: ApiErrorData | null;

  constructor(message: string, status = 0, data: unknown = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.data = data && typeof data === 'object' && !Array.isArray(data) ? data as ApiErrorData : null;
  }
}

const TOKEN_PATH = /^\/api\/guest\/[a-f0-9]{40}$/i;
const MESSAGE_LIST_PATH = /^\/api\/sessions\/[^/]+\/messages$/;
const CUSTOMER_READ_PATH = /^\/api\/sessions\/[^/]+\/customer-read$/;

function allowedVisitorApiPath(path: string) {
  return TOKEN_PATH.test(path)
    || MESSAGE_LIST_PATH.test(path)
    || CUSTOMER_READ_PATH.test(path)
    || path === '/api/messages'
    || path === '/api/upload';
}

function requestPath(input: RequestInfo | URL) {
  const raw = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
  const url = new URL(raw, window.location.origin);
  if (url.origin !== window.location.origin) throw new ApiError('请求地址不可用', 0);
  if (!allowedVisitorApiPath(url.pathname)) throw new ApiError('请求地址不可用', 0);
  return url.pathname;
}

async function parseBody(response: Response) {
  const text = await response.text().catch(() => '');
  if (!text) return null;
  try { return JSON.parse(text); } catch { return { error: text }; }
}

function messageForStatus(status: number, data: unknown, path: string) {
  const backend = data && typeof data === 'object' && !Array.isArray(data)
    ? String((data as ApiErrorData).error || '')
    : '';
  if (TOKEN_PATH.test(path) && [401, 403, 404, 410].includes(status)) return '链接不存在或已失效';
  if ([401, 403, 404, 410].includes(status)) return '当前会话已不可用';
  if (status === 413) return '发送内容过大';
  if (status === 400 && backend) return backend;
  if (status >= 500) return '服务器错误，请稍后重试';
  return backend || '网络不稳定，请重试';
}

function publishPresentationAfterConsume(path: string, data: unknown) {
  if (!TOKEN_PATH.test(path) || !data || typeof data !== 'object' || Array.isArray(data)) return;
  const presentation = (data as Record<string, unknown>).presentation;
  window.dispatchEvent(new CustomEvent('visitor:presentation', {
    detail: presentation && typeof presentation === 'object' ? presentation : null,
  }));
  // Remove the bearer invite token from the address bar immediately. A reload of this
  // token-free URL is intentionally not a valid visitor entry.
  try { history.replaceState(null, '', '/session'); } catch {}
}

async function fetchOnce(input: RequestInfo | URL, options: ApiFetchOptions) {
  const path = requestPath(input);
  const timeoutMs = options.timeoutMs ?? 10000;
  const controller = isAbortControllerSupported() ? new AbortController() : null;
  const requestOptions = { ...options };
  delete requestOptions.timeoutMs;
  delete requestOptions.retryGet;
  const request = fetch(input, {
    ...requestOptions,
    credentials: 'same-origin',
    referrerPolicy: 'origin',
    signal: controller?.signal,
  });
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      if (controller) controller.abort();
      else reject(new ApiError('请求超时，请检查网络后重试', 408));
    }, timeoutMs);
  });

  try {
    const response = await Promise.race([request, timeout]);
    const rawData = await parseBody(response);
    if (!response.ok) throw new ApiError(messageForStatus(response.status, rawData, path), response.status, rawData);
    const data = normalizeApiPayload(rawData);
    publishPresentationAfterConsume(path, data);
    return data;
  } catch (error) {
    if (isAbortError(error)) throw new ApiError('请求超时，请检查网络后重试', 408);
    if (error instanceof ApiError) throw error;
    throw new ApiError('网络不稳定，请重试', 0);
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function apiFetch<T = unknown>(input: RequestInfo | URL, options: ApiFetchOptions = {}): Promise<T> {
  const method = String(options.method || 'GET').toUpperCase();
  try {
    return await fetchOnce(input, options) as T;
  } catch (error) {
    if (method === 'GET' && options.retryGet !== false) return await fetchOnce(input, { ...options, retryGet: false }) as T;
    throw error;
  }
}
