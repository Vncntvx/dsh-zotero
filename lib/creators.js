/**
 * Creator display formatting shared by host tool output and the browser panel.
 * The module carries no host authority, so the client graph may import it.
 * @module dsh-zotero/creators
 */
/** The creator role assumed when Zotero omits `creatorType`. */
export const DEFAULT_CREATOR_TYPE = 'author';
/** Format one creator as `Name` with a non-default role suffix. */
export function formatCreatorDisplayName(creator) {
    const name = creator.name ?? `${creator.firstName ?? ''} ${creator.lastName ?? ''}`.trim();
    if (name === '')
        return '';
    return creator.creatorType !== DEFAULT_CREATOR_TYPE && creator.creatorType !== undefined
        ? `${name} (${creator.creatorType})`
        : name;
}
/** Format a creator list, omitting empty names and joining with semicolons. */
export function formatCreatorsList(creators) {
    return creators
        .map(formatCreatorDisplayName)
        .filter((name) => name !== '')
        .join('; ');
}
//# sourceMappingURL=creators.js.map