/**
 * One-line display text of a thrown value, shared by the render-fault
 * fallbacks (surface and card boundaries).
 * @module dsh-zotero/client/error-text
 */

/** The first line of a thrown value, as a fallback's one-line detail. */
export function messageOf(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  const firstLine = message.split('\n')[0].trim()
  return firstLine || String(error)
}
