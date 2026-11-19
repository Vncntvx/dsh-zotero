/**
 * The Markdown H1 naming a parsed document, shared by the host commit path
 * (stored into artifact meta) and the client tab title. Pure string handling
 * only: no host authority, no React.
 * @module dsh-zotero/parsed-title
 */
/** ATX headings outside fenced and indented code, with original UTF-16 offsets. */
export function markdownHeadingsOf(markdown) {
    const headings = [];
    let fence;
    for (const line of markdown.matchAll(/^.*$/gm)) {
        const value = line[0].replace(/\r$/, '');
        const delimiter = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(value);
        if (fence !== undefined) {
            if (delimiter !== null &&
                delimiter[1][0] === fence.marker &&
                delimiter[1].length >= fence.length &&
                delimiter[2].trim() === '')
                fence = undefined;
            continue;
        }
        if (delimiter !== null) {
            if (delimiter[1][0] !== '`' || !delimiter[2].includes('`'))
                fence = { marker: delimiter[1][0], length: delimiter[1].length };
            continue;
        }
        const heading = /^ {0,3}(#{1,6})(?:[ \t]+|$)(.*)$/.exec(value);
        if (heading !== null)
            headings.push({
                level: heading[1].length,
                title: heading[2].replace(/[ \t]+#+[ \t]*$/, '').trim(),
                start: line.index,
            });
    }
    return headings;
}
/** The first real Markdown H1, with emphasis and code spans stripped. */
export function extractMarkdownTitleOf(markdown) {
    const heading = markdownHeadingsOf(markdown).find((candidate) => candidate.level === 1);
    if (heading === undefined)
        return undefined;
    return (heading.title
        .replace(/\*{1,2}([^*]+)\*{1,2}/g, '$1')
        .replace(/`([^`]+)`/g, '$1')
        .trim() || undefined);
}
/**
 * Zotero's default attachment names carry no paper identity; the stored
 * Markdown title is the better tab name for them.
 */
export function isGenericParsedTitle(value) {
    return value === undefined || value === '' || value === 'PDF' || value === 'Full Text PDF';
}
//# sourceMappingURL=parsed-title.js.map