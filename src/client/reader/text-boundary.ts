/** UTF-16 helpers for excerpts that must not split a surrogate pair. */

const HIGH_SURROGATE_START = 0xd800
const HIGH_SURROGATE_END = 0xdbff
const LOW_SURROGATE_START = 0xdc00
const LOW_SURROGATE_END = 0xdfff

function isHighSurrogate(code: number) {
  return code >= HIGH_SURROGATE_START && code <= HIGH_SURROGATE_END
}

function isLowSurrogate(code: number) {
  return code >= LOW_SURROGATE_START && code <= LOW_SURROGATE_END
}

/** Whether `index` falls between complete code points, not inside a surrogate pair. */
export function isCharacterBoundary(text: string, index: number): boolean {
  return !(isLowSurrogate(text.charCodeAt(index)) && isHighSurrogate(text.charCodeAt(index - 1)))
}

/** A prefix of at most `limit` code units that drops a trailing split surrogate. */
export function textPrefix(text: string, limit: number): string {
  const last = text.charCodeAt(limit - 1)
  return text.slice(0, isHighSurrogate(last) ? limit - 1 : limit)
}
