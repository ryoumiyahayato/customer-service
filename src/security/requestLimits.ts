export function jsonObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

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
    // An unreadable request stream must never bypass a size boundary.
    return true;
  }
}

export async function readJsonObjectWithinLimit(request: Request, maxBytes: number) {
  if (await requestStreamExceeds(request, maxBytes)) {
    return { body: {}, tooLarge: true } as const;
  }
  const body = jsonObject(await request.clone().json().catch(() => null));
  return { body, tooLarge: false } as const;
}
