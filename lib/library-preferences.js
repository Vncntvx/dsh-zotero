/** Shared, host-free contract for accepted library preferences. */
import { DEFAULT_JOURNAL_METRIC_DETAIL_FIELDS, DEFAULT_JOURNAL_METRIC_LIST, EASYSCHOLAR_SECRET_KEY_REF, isJournalMetricDetailFields, journalMetricDetailFieldsOf, journalMetricListRulesOf, } from './journal-metrics.js';
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
    journalMetricsEnabled: false,
    easyScholarSecretKeyRef: EASYSCHOLAR_SECRET_KEY_REF,
    journalMetricListOrder: DEFAULT_JOURNAL_METRIC_LIST,
    journalMetricDetailFields: DEFAULT_JOURNAL_METRIC_DETAIL_FIELDS,
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
    for (const key of ['rightSidebarEnabled', 'allowUrlPdfRead', 'journalMetricsEnabled']) {
        if (typeof result[key] !== 'boolean')
            throw new Error(`Invalid library preference: ${key}`);
    }
    if (typeof result.easyScholarSecretKeyRef !== 'string' ||
        !/^[A-Za-z_][A-Za-z0-9_]*$/.test(result.easyScholarSecretKeyRef)) {
        throw new Error('Invalid library preference: easyScholarSecretKeyRef');
    }
    const list = journalMetricListRulesOf(result.journalMetricListOrder);
    if (!list) {
        throw new Error('Invalid library preference: journalMetricListOrder');
    }
    if (!isJournalMetricDetailFields(result.journalMetricDetailFields)) {
        throw new Error('Invalid library preference: journalMetricDetailFields');
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
        journalMetricListOrder: Object.freeze({
            ...list,
            international: Object.freeze([...list.international]),
            chineseCore: Object.freeze([...list.chineseCore]),
        }),
        journalMetricDetailFields: Object.freeze(journalMetricDetailFieldsOf(result.journalMetricDetailFields)),
    });
}
//# sourceMappingURL=library-preferences.js.map