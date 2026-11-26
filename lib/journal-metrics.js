/** Official EasyScholar fields selectable in settings. */
export const JOURNAL_METRIC_FIELDS = [
    'sci',
    'sciif',
    'sciUp',
    'sciUpSmall',
    'sciUpTop',
    'sciBase',
    'ssci',
    'jci',
    'sciif5',
    'ccf',
    'cssci',
    'cscd',
    'pku',
    'ei',
    'ahci',
    'sciwarn',
    'esi',
    'ajg',
    'fms',
    'udtd24',
    'ft50',
    'zhongguokejihexin',
    'swufe',
    'cufe',
    'uibe',
    'sdufe',
    'xdu',
    'swjtu',
    'ruc',
    'xmu',
    'sjtu',
    'fdu',
    'hhu',
    'scu',
    'cqu',
    'nju',
    'xju',
    'cug',
    'cju',
    'zju',
    'cpu',
    'xr',
    'xrWarn',
    'xrTop',
    'xrSmall',
];
export const JOURNAL_METRIC_DETAIL_FIELDS = [...JOURNAL_METRIC_FIELDS, 'custom'];
export function journalMetricDetailFieldsOf(fields) {
    return JOURNAL_METRIC_DETAIL_FIELDS.filter((field) => fields.includes(field));
}
export const DEFAULT_JOURNAL_METRIC_DETAIL_FIELDS = Object.freeze([
    'sci',
    'sciif',
    'sciUp',
]);
export const JOURNAL_METRIC_LIST_CANDIDATES = ['jcr', ...JOURNAL_METRIC_FIELDS];
export const JOURNAL_METRIC_LIST_PROFILES = ['international', 'chineseCore'];
export const JOURNAL_METRIC_LIST_LIMITS = [1, 2, 3];
const CHINESE_CORE_FIELDS = ['cssci', 'cscd', 'pku', 'zhongguokejihexin'];
const INTERNATIONAL_FIELDS = [
    'sci',
    'ssci',
    'sciif',
    'sciif5',
    'jci',
    'sciBase',
    'sciUp',
    'sciUpSmall',
    'sciUpTop',
    'esi',
    'ei',
    'ahci',
];
export const DEFAULT_JOURNAL_METRIC_LIST = Object.freeze({
    international: Object.freeze(['jcr', 'sciif', 'sciUp']),
    chineseCore: Object.freeze(CHINESE_CORE_FIELDS),
    dualPriority: 'international',
    limit: 3,
});
export const EASYSCHOLAR_SECRET_KEY_REF = 'EASYSCHOLAR_SECRET_KEY';
export const JOURNAL_NAME_MAX_LENGTH = 1024;
export const JOURNAL_METRIC_FAILURES = [
    'credential',
    'rateLimited',
    'quotaExceeded',
    'requestRejected',
    'invalidResponse',
    'serviceUnavailable',
    'connectionFailed',
    'timedOut',
    'unavailable',
];
function isLegacyOrder(value) {
    return (Array.isArray(value) &&
        JOURNAL_METRIC_LIST_LIMITS.some((length) => length === value.length) &&
        new Set(value).size === value.length &&
        value.every((field) => JOURNAL_METRIC_FIELDS.includes(field)));
}
export function isJournalMetricListRules(value) {
    if (value === null || typeof value !== 'object' || Object.keys(value).length !== 4)
        return false;
    const list = value;
    return (JOURNAL_METRIC_LIST_PROFILES.includes(list.dualPriority) &&
        JOURNAL_METRIC_LIST_LIMITS.includes(list.limit) &&
        JOURNAL_METRIC_LIST_PROFILES.every((profile) => {
            const candidates = list[profile];
            return (Array.isArray(candidates) &&
                new Set(candidates).size === candidates.length &&
                candidates.every((candidate) => JOURNAL_METRIC_LIST_CANDIDATES.includes(candidate)));
        }));
}
/** Resolve a saved single-order profile or an existing rule set into list rules. */
export function journalMetricListRulesOf(value) {
    if (isJournalMetricListRules(value))
        return value;
    if (!isLegacyOrder(value))
        return undefined;
    if (value.join(',') === DEFAULT_JOURNAL_METRIC_DETAIL_FIELDS.join(',')) {
        return DEFAULT_JOURNAL_METRIC_LIST;
    }
    const international = value.filter((field) => !CHINESE_CORE_FIELDS.some((core) => core === field));
    const chineseCore = value.filter((field) => !INTERNATIONAL_FIELDS.includes(field));
    return {
        international: international.length ? international : DEFAULT_JOURNAL_METRIC_LIST.international,
        chineseCore: chineseCore.length ? chineseCore : DEFAULT_JOURNAL_METRIC_LIST.chineseCore,
        dualPriority: DEFAULT_JOURNAL_METRIC_LIST.dualPriority,
        limit: value.length,
    };
}
export function journalMetricListValues(official, rules, compact) {
    const values = new Map(official.map(({ field, value }) => [field, value]));
    const international = INTERNATIONAL_FIELDS.some((field) => values.has(field));
    const chineseCore = CHINESE_CORE_FIELDS.some((field) => values.has(field));
    const secondary = rules.dualPriority === 'international' ? 'chineseCore' : 'international';
    const candidates = international && chineseCore
        ? rules[rules.dualPriority]
        : international
            ? rules.international
            : chineseCore
                ? rules.chineseCore
                : [...rules[rules.dualPriority], ...rules[secondary]];
    const selected = new Map();
    const limit = compact ? Math.min(2, rules.limit) : rules.limit;
    for (const candidate of candidates) {
        const field = candidate === 'jcr' ? (values.has('sci') ? 'sci' : 'ssci') : candidate;
        const value = values.get(field);
        if (value === undefined)
            continue;
        selected.set(field, value);
        if (selected.size >= limit)
            break;
    }
    return Array.from(selected, ([field, value]) => ({ field, value }));
}
export function isJournalMetricDetailFields(value) {
    return (Array.isArray(value) &&
        new Set(value).size === value.length &&
        value.every((field) => JOURNAL_METRIC_DETAIL_FIELDS.includes(field)));
}
export function journalNameOf(value) {
    if (typeof value !== 'string')
        return undefined;
    const name = value.trim().normalize('NFC');
    return name && name.length <= JOURNAL_NAME_MAX_LENGTH ? name : undefined;
}
//# sourceMappingURL=journal-metrics.js.map