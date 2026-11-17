/** Zotero's tag query syntax cannot express an OR separator inside one literal tag. */
export function isLiteralSearchTag(tag: string): boolean {
  return tag.trim() !== '' && !tag.includes('||')
}
