const SENSITIVE_QUERY_KEYS = new Set(['token', 'code', 'session', 'cookie', 'password', 'secret', 'setupToken']);

export function redactUrl(value: string): string {
  try {
    const url = new URL(value);
    for (const key of Array.from(url.searchParams.keys())) {
      if (SENSITIVE_QUERY_KEYS.has(key) || /token|code|session|cookie|password|secret/i.test(key)) {
        url.searchParams.set(key, '[REDACTED]');
      }
    }
    return url.toString();
  } catch {
    return value.replace(/([?&](?:token|code|session|cookie|password|secret|setupToken)=)[^&\s]+/gi, '$1[REDACTED]');
  }
}

export function redactText(value: string): string {
  return value
    .replace(/([?&](?:token|code|session|cookie|password|secret|setupToken)=)[^&\s]+/gi, '$1[REDACTED]')
    .replace(/((?:token|code|session|cookie|password|secret|setupToken)\s*[:=]\s*)[^\s,;]+/gi, '$1[REDACTED]');
}

export function redactObject<T>(value: T): T {
  return JSON.parse(redactText(JSON.stringify(value))) as T;
}
