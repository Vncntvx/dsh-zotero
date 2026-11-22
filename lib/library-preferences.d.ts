/** Shared, host-free contract for accepted library preferences. */
export declare const LIBRARY_SECTIONS: readonly ['abstract', 'attachments', 'notes', 'annotations'];
export type LibrarySection = (typeof LIBRARY_SECTIONS)[number];
export declare const LIBRARY_CHOICES: {
    readonly listDensity: readonly ['comfortable', 'compact'];
    readonly titleLines: readonly [1, 2];
    readonly localPdfOpenTarget: readonly ['sidebar', 'float', 'zotero'];
    readonly urlPdfOpenTarget: readonly ['sidebar', 'float'];
    readonly reopenBehavior: readonly ['restore', 'allItems'];
    readonly scopeChangeBehavior: readonly ['preserve', 'clear'];
    readonly defaultCopyFormat: readonly ['citation', 'bibliography', 'bibtex', 'biblatex', 'ris', 'csljson', 'csv', 'itemInfo'];
    readonly chatInsertContent: readonly ['reference', 'referenceAndAbstract'];
};
type Choices = typeof LIBRARY_CHOICES;
export type LibraryPreferences = {
    readonly [K in keyof Choices]: Choices[K][number];
} & {
    readonly rightSidebarEnabled: boolean;
    readonly allowUrlPdfRead: boolean;
    readonly detailExpandedSections: readonly LibrarySection[];
};
export type LibraryPreferenceKey = keyof LibraryPreferences;
export declare const LIBRARY_DEFAULTS: LibraryPreferences;
export declare const LIBRARY_PREFERENCE_KEYS: LibraryPreferenceKey[];
/** Resolve omitted fields only; malformed values are refused rather than repaired. */
export declare function libraryPreferencesOf(raw: Readonly<Record<string, unknown>>): LibraryPreferences;
export {};
//# sourceMappingURL=library-preferences.d.ts.map