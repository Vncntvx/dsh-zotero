/**
 * Creator display formatting shared by host tool output and the browser panel.
 * The module carries no host authority, so the client graph may import it.
 * @module dsh-zotero/creators
 */
/** The creator role assumed when Zotero omits `creatorType`. */
export declare const DEFAULT_CREATOR_TYPE = "author";
/** The creator fields a display name needs. */
export interface CreatorDisplayInput {
    readonly creatorType?: string;
    readonly name?: string;
    readonly firstName?: string;
    readonly lastName?: string;
}
/** Format one creator as `Name` with a non-default role suffix. */
export declare function formatCreatorDisplayName(creator: CreatorDisplayInput): string;
/** Format a creator list, omitting empty names and joining with semicolons. */
export declare function formatCreatorsList(creators: readonly CreatorDisplayInput[]): string;
//# sourceMappingURL=creators.d.ts.map