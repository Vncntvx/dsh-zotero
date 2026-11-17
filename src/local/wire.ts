/** Local API spelling shared by versioned reads and item-key batches. */
import { parseNonNegativeSafeInteger } from '../json.js'

export function numericHeader(headers: Headers, name: string): number | undefined {
  return parseNonNegativeSafeInteger(headers.get(name))
}

/** Zotero splits one comma-joined itemKey value; callers own the 50-key batch bound. */
export function itemKeyList(keys: readonly string[]): string {
  return keys.join(',')
}
