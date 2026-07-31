export function recordChatMetric(
  name: string,
  started: number,
  extra: Record<string, number | string> = {},
) {
  console.debug('[chat_metric]', name, Math.round(performance.now() - started), extra);
}
