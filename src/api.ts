import { isAbortControllerSupported } from './compat';

export class ApiError extends Error {
  status: number;
  data: any;

  constructor(message: string, status = 0, data: any = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.data = data;
  }
}

type ApiFetchOptions = RequestInit & { timeoutMs?: number; retryGet?: boolean };

async function parseBody(response: Response) {
  const text = await response.text().catch(() => '');
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { error: text };
  }
}

function pathFromInput(input: RequestInfo | URL) {
  const raw = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
  try {
    return new URL(raw, window.location.origin).pathname;
  } catch {
    return '';
  }
}

function messageForStatus(status: number, data: any, path: string) {
  const backend = typeof data?.error === 'string' ? data.error : '';
  if (path === '/api/auth/login' && status === 401) return '账号或密码错误';
  if (path === '/api/account/login' && status === 401) return '账号或密码错误';
  if (path === '/api/auth/me' && status === 401) return '请登录';
  if (path.startsWith('/api/guest/') && [401, 403, 404, 410].includes(status)) return '链接不存在或已失效';
  if (status === 400 && backend) return backend;
  if (status === 401) return '登录已过期，请重新登录';
  if (status >= 500) return '服务器错误，请稍后重试';
  return backend || '网络不稳定，请重试';
}

async function fetchOnce(input: RequestInfo | URL, options: ApiFetchOptions) {
  const timeoutMs = options.timeoutMs ?? 10000;
  const supportsAbort = isAbortControllerSupported();
  const controller = supportsAbort ? new AbortController() : null;
  const timer = setTimeout(() => controller?.abort(), timeoutMs);
  const credentials = options.credentials ?? 'same-origin';
  const request = fetch(input, { ...options, credentials, signal: controller?.signal });
  const timeout = new Promise<Response>((_, reject) => {
    if (!supportsAbort) setTimeout(() => reject(new ApiError('请求超时，请检查网络后重试', 408)), timeoutMs);
  });

  try {
    const response = await (supportsAbort ? request : Promise.race([request, timeout]));
    const data = await parseBody(response);
    if (!response.ok) throw new ApiError(messageForStatus(response.status, data, pathFromInput(input)), response.status, data);
    return data;
  } catch (error: any) {
    if (error?.name === 'AbortError') throw new ApiError('请求超时，请检查网络后重试', 408);
    if (error instanceof ApiError) throw error;
    throw new ApiError('网络不稳定，请重试', 0);
  } finally {
    clearTimeout(timer);
  }
}

export async function apiFetch<T = any>(input: RequestInfo | URL, options: ApiFetchOptions = {}): Promise<T> {
  const method = String(options.method || 'GET').toUpperCase();
  try {
    return await fetchOnce(input, options) as T;
  } catch (error) {
    if (method === 'GET' && options.retryGet !== false) return await fetchOnce(input, { ...options, retryGet: false }) as T;
    throw error;
  }
}
