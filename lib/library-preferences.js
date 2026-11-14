/** Shared, host-free contract for accepted library preferences. */
export const LIBRARY_SECTIONS = ['abstract', 'attachments', 'notes', 'annotations'];
export const LIBRARY_CHOICES = {
    listDensity: ['comfortable', 'compact'],
    titleLines: [1, 2],
    localPdfOpenTarget: ['sidebar', 'float', 'zotero'],
    urlPdfOpenTarget: ['sidebar', 'float'],
    reopenBehavior: ['restore', 'allItems'],
    scopeChangeBehavior: ['preserve', 'clear'],
    defaultCopyFormat: [
        'citation',
        'bibliography',
        'bibtex',
        'biblatex',
        'ris',
        'csljson',
        'csv',
        'itemInfo',
    ],
    chatInsertContent: ['reference', 'referenceAndAbstract'],
};
export const LIBRARY_DEFAULTS = Object.freeze({
    rightSidebarEnabled: true,
    listDensity: 'comfortable',
    titleLines: 2,
    detailExpandedSections: Object.freeze(['abstract', 'attachments']),
    localPdfOpenTarget: 'sidebar',
    urlPdfOpenTarget: 'sidebar',
    allowUrlPdfRead: false,
    reopenBehavior: 'restore',
    scopeChangeBehavior: 'preserve',
    defaultCopyFormat: 'citation',
    chatInsertContent: 'reference',
});
export const LIBRARY_PREFERENCE_KEYS = Object.keys(LIBRARY_DEFAULTS);
/** Resolve omitted fields only; malformed values are refused rather than repaired. */
export function libraryPreferencesOf(raw) {
    const result = Object.fromEntries(LIBRARY_PREFERENCE_KEYS.map((key) => [
        key,
        Object.hasOwn(raw, key) ? raw[key] : LIBRARY_DEFAULTS[key],
    ]));
    for (const key of ['rightSidebarEnabled', 'allowUrlPdfRead']) {
        if (typeof result[key] !== 'boolean')
            throw new Error(`Invalid library preference: ${key}`);
    }
    for (const key of Object.keys(LIBRARY_CHOICES)) {
        if (!LIBRARY_CHOICES[key].includes(result[key])) {
            throw new Error(`Invalid library preference: ${key}`);
        }
    }
    const sections = result.detailExpandedSections;
    if (!Array.isArray(sections) ||
        sections.some((v) => !LIBRARY_SECTIONS.includes(v)) ||
        new Set(sections).size !== sections.length) {
        throw new Error('Invalid library preference: detailExpandedSections');
    }
    return Object.freeze({
        ...result,
        detailExpandedSections: Object.freeze([...sections]),
    });
}
//# sourceMappingURL=library-preferences.js.map