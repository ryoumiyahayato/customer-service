export async function consumeRateLimit(
  database: D1Database,
  key: string,
  limit: number,
  windowMs: number,
): Promise<number | null> {
  const nowMs = Date.now();
  const resetAt = nowMs + windowMs;
  await database.prepare(
    'INSERT INTO rate_limits(key,count,reset_at) VALUES(?,0,?) ON CONFLICT(key) DO NOTHING',
  ).bind(key, resetAt).run();
  const consumed = await database.prepare(
    `UPDATE rate_limits
        SET count=CASE WHEN reset_at <= ? THEN 1 ELSE count+1 END,
            reset_at=CASE WHEN reset_at <= ? THEN ? ELSE reset_at END
      WHERE key=? AND (reset_at <= ? OR count < ?)`,
  ).bind(nowMs, nowMs, resetAt, key, nowMs, limit).run();
  if (Number(consumed?.meta?.changes || 0) > 0) return null;
  const row = await database.prepare('SELECT reset_at FROM rate_limits WHERE key=?')
    .bind(key)
    .first<{ reset_at: number }>();
  return Math.max(1, Math.ceil((Number(row?.reset_at || resetAt) - nowMs) / 1000));
}
