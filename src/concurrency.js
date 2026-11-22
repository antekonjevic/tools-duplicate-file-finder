/**
 * Runs `task` for every item with at most `limit` running at once.
 * Tasks are expected to handle their own errors; one that throws rejects the
 * whole run.
 *
 * @template T
 * @param {readonly T[]} items
 * @param {number} limit
 * @param {(item: T) => Promise<void>} task
 */
export async function forEachLimit(items, limit, task) {
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const item = items[next];
      next += 1;
      await task(item);
    }
  };
  const workers = Array.from({ length: Math.min(limit, items.length) }, worker);
  await Promise.all(workers);
}
