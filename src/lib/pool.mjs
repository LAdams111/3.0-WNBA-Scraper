/**
 * Run async work over `items` with at most `concurrency` in flight at once.
 * `mapper` may throw; each slot stores { ok, value } or { ok: false, error }.
 */
export async function poolMap(items, concurrency, mapper) {
  const n = items.length;
  if (n === 0) return [];
  const results = new Array(n);
  const limit = Math.max(1, Math.min(concurrency, n));
  let next = 0;

  async function worker() {
    for (;;) {
      const i = next++;
      if (i >= n) return;
      try {
        results[i] = { ok: true, value: await mapper(items[i], i) };
      } catch (error) {
        results[i] = { ok: false, error };
      }
    }
  }

  await Promise.all(Array.from({ length: limit }, () => worker()));
  return results;
}
