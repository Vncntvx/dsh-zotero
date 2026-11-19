/** Zotero's tag query syntax cannot express an OR separator inside one literal tag. */
export function isLiteralSearchTag(tag) {
    return tag.trim() !== '' && !tag.includes('||');
}
//# sourceMappingURL=search-tags.js.map