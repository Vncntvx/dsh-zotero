/**
 * The `zotero://` ref strings the write paths hand back.
 *
 * A leaf module: the write domains and the write verdicts both need these
 * builders, and the verdicts sit below the domains in the dependency graph,
 * so the builders cannot live in the domain module without a cycle.
 * @module dsh-zotero/local/write-refs
 */
export declare function itemRef(key: string, serverId: string): string;
export declare function collectionRef(key: string, serverId: string): string;
export declare function searchRef(key: string, serverId: string): string;
//# sourceMappingURL=write-refs.d.ts.map