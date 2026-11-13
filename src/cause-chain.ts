/**
 * Bounded walk of an error's cause chain.
 *
 * `Error.cause` and `AggregateError.errors` can nest, cycle, and fan out. Both
 * `errnoCodeOf` (`errors.ts`) and the public-address rejection lookup
 * (`public-url.ts`) need the same walk, so the bound lives here once: a node
 * budget, a separate chain-depth budget for `cause` links, and a fan-out cap
 * for aggregate members. A `seen` set makes a cyclic cause harmless.
 * @module dsh-zotero/cause-chain
 */

/** How many nodes, cause links, and aggregate members one walk may visit. */
const MAX_NODES = 64
const MAX_CAUSE_DEPTH = 10
const MAX_AGGREGATE_MEMBERS = 32

interface QueueEntry {
  readonly value: unknown
  readonly depth: number
}

/**
 * Walk the cause chain breadth-first and return the first value a visitor
 * accepts. A visitor returns `undefined` to keep walking; any other value ends
 * the walk, so a caller that wants a boolean produces `true` explicitly.
 * @param error - any thrown value.
 * @param visit - classify one node; `undefined` means "keep looking".
 * @returns the accepted value, or undefined when the bounded walk ends.
 */
export function findInCauseChain<T>(
  error: unknown,
  visit: (current: object) => T | undefined,
): T | undefined {
  const seen = new Set<object>()
  const queue: QueueEntry[] = [{ value: error, depth: 0 }]
  let visited = 0
  while (queue.length > 0 && visited < MAX_NODES) {
    const entry = queue.shift()
    if (entry === undefined) break
    const current = entry.value
    if (typeof current !== 'object' || current === null || seen.has(current)) continue
    seen.add(current)
    visited += 1
    const found = visit(current)
    if (found !== undefined) return found
    if (entry.depth < MAX_CAUSE_DEPTH) {
      if (current instanceof Error && current.cause !== undefined) {
        queue.push({ value: current.cause, depth: entry.depth + 1 })
      }
      if (current instanceof AggregateError) {
        for (const member of current.errors.slice(0, MAX_AGGREGATE_MEMBERS)) {
          queue.push({ value: member, depth: entry.depth + 1 })
        }
      }
    }
  }
  return undefined
}
