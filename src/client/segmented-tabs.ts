/**
 * Typed construction of a non-empty tab tuple for the host `SegmentedTabs`.
 *
 * `SegmentedTabs` requires a non-empty tuple because its indicator width and
 * grid columns divide by `items.length`. Mapping a plain array loses that
 * invariant, so call sites would have to assert it; this helper carries it in
 * the type instead.
 * @module dsh-zotero/client/segmented-tabs
 */

import type { SegmentedTab } from '@deepseek-ai/dsh-client-ui-primitives'

/**
 * Map a non-empty tuple of entries to a same-length tuple of tabs.
 *
 * `SegmentedTabs` requires a non-empty tuple because its indicator width and
 * grid columns divide by `items.length`. Mapping a plain array loses both the
 * length and the invariant, so call sites would have to assert them; this
 * helper keeps both in the type. The mapped type also tolerates heterogeneous
 * entries, which is what the lens bar's two different entries are.
 * @param entries - at least one entry; the tuple type is what proves it.
 * @param build - the tab one entry becomes.
 * @returns the tabs, position for position, with the non-empty invariant preserved.
 */
export function mapTuple<Entries extends readonly [unknown, ...unknown[]], Value extends string>(
  entries: Entries,
  build: (entry: Entries[number]) => SegmentedTab<Value>,
): { -readonly [K in keyof Entries]: SegmentedTab<Value> } {
  // `map` preserves length; the assertion states what the type already claims.
  return entries.map((entry) => build(entry)) as {
    -readonly [K in keyof Entries]: SegmentedTab<Value>
  }
}
