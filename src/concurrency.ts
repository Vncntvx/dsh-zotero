/**
 * Bounded-concurrency task pooling shared by the graph walk and export.
 * @module dsh-zotero/concurrency
 */

/**
 * Map `items` through `worker` with at most `concurrency` calls in flight,
 * preserving the input order in the results. A worker rejection propagates
 * immediately and stops the pool from starting further items; workers
 * already in flight keep running to completion.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  let failed = false
  const run = async (): Promise<void> => {
    for (;;) {
      if (failed) return
      const index = next
      next += 1
      if (index >= items.length) return
      try {
        results[index] = await worker(items[index]!)
      } catch (error) {
        failed = true
        throw error
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => run()))
  return results
}
