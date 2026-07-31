export function contentLengthExceeds(request: Request, maxBytes: number) {
  const raw = request.headers.get('content-length');
  return Boolean(raw && Number(raw) > maxBytes);
}

export async function requestStreamExceeds(request: Request, maxBytes: number) {
  if (contentLengthExceeds(request, maxBytes)) return true;
  const reader = request.clone().body?.getReader();
  if (!reader) return false;
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return false;
      total += value?.byteLength || 0;
      if (total > maxBytes) {
        await reader.cancel();
        return true;
      }
    }
  } catch {
    return false;
  }
}

export async function readJsonObjectWithinLimit(request: Request, maxBytes: number) {
  if (await requestStreamExceeds(request, maxBytes)) {
    return { body: {}, tooLarge: true } as const;
  }
  const value = await request.clone().json().catch(() => null);
  const body = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  return { body, tooLarge: false } as const;
}
