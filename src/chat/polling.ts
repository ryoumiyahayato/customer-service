export function fallbackDelay(misses: number) {
  // WebSocket remains the primary transport. When it is unavailable, keep the HTTP
  // fallback responsive enough that a new message is normally visible within 3 seconds.
  return misses < 4 ? 800 : misses < 12 ? 1600 : 2500;
}
