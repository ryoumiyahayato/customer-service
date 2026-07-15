const SENSITIVE_QUERY_KEYS = new Set([
  'token',
  'code',
  'session',
  'cookie',
  'password',
  'secret',
  'setupToken',
  'SETUP_TOKEN',
  'ENCRYPTION_KEY',
  'BACKUP_SIGNING_KEY',
  'key',
]);

export function redactUrl(value: string): string {
  try {
    const url = new URL(value);
    if (url.username) url.username = '[REDACTED]';
    if (url.password) url.password = '[REDACTED]';
    for (const key of Array.from(url.searchParams.keys())) {
      if (SENSITIVE_QUERY_KEYS.has(key) || /token|code|session|cookie|password|secret|key/i.test(key)) {
        url.searchParams.set(key, '[REDACTED]');
      }
    }
    if (url.hash) url.hash = '#[REDACTED]';
    return url.toString();
  } catch {
    return value
      .replace(/(https?:\/\/)[^/@\s]+@/gi, '$1[REDACTED]@')
      .replace(/([?&](?:token|code|session|cookie|password|secret|setupToken|SETUP_TOKEN|ENCRYPTION_KEY|BACKUP_SIGNING_KEY|key)=)[^&\s]+/gi, '$1[REDACTED]')
      .replace(/#[^\s]*/g, '#[REDACTED]');
  }
}

export function redactText(value: string): string {
  return value
    .replace(/https?:\/\/[^\s"'<>]+/gi, (url) => redactUrl(url))
    .replace(/(https?:\/\/)[^/@\s]+@/gi, '$1[REDACTED]@')
    .replace(/([?&](?:token|code|session|cookie|password|secret|setupToken|SETUP_TOKEN|ENCRYPTION_KEY|BACKUP_SIGNING_KEY|key)=)[^&\s]+/gi, '$1[REDACTED]')
    .replace(/((?:token|code|session|cookie|password|secret|setupToken|SETUP_TOKEN|ENCRYPTION_KEY|BACKUP_SIGNING_KEY|key)\s*[:=]\s*)[^\s,;]+/gi, '$1[REDACTED]');
}

export function redactObject<T>(value: T): T {
  return JSON.parse(redactText(JSON.stringify(value))) as T;
}
