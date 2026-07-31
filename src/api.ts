import { isAbortControllerSupported, isAbortError } from './compat';
import { normalizeApiPayload } from './chat/mappers';

type ApiErrorData = Record<string, unknown> & {
  error?: string;
  reason?: unknown;
};

function asApiErrorData(data: unknown): ApiErrorData | null {
  return data && typeof data === 'object' ? data as ApiErrorData : null;
}

export class ApiError extends Error {
  status: number;
  data: ApiErrorData | null;

  constructor(message: string, status = 0, data: unknown = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.data = asApiErrorData(data);
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

function messageForStatus(status: number, data: unknown, path: string) {
  const backend = asApiErrorData(data)?.error || '';
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
  const controller = isAbortControllerSupported() ? new AbortController() : null;
  const requestOptions = { ...options };
  delete requestOptions.timeoutMs;
  delete requestOptions.retryGet;
  const credentials = options.credentials ?? 'same-origin';
  const request = fetch(input, { ...requestOptions, credentials, signal: controller?.signal });
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
    if (!response.ok) throw new ApiError(messageForStatus(response.status, rawData, pathFromInput(input)), response.status, rawData);
    return normalizeApiPayload(rawData);
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
