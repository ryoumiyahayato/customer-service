export function fallbackDelay(misses: number) {
  return misses < 3 ? 2000 : misses < 12 ? 5000 : 10000;
}
