/** Official EasyScholar fields selectable in settings. */
export declare const JOURNAL_METRIC_FIELDS: readonly ['sci', 'sciif', 'sciUp', 'sciUpSmall', 'sciUpTop', 'sciBase', 'ssci', 'jci', 'sciif5', 'ccf', 'cssci', 'cscd', 'pku', 'ei', 'ahci', 'sciwarn', 'esi', 'ajg', 'fms', 'udtd24', 'ft50', 'zhongguokejihexin', 'swufe', 'cufe', 'uibe', 'sdufe', 'xdu', 'swjtu', 'ruc', 'xmu', 'sjtu', 'fdu', 'hhu', 'scu', 'cqu', 'nju', 'xju', 'cug', 'cju', 'zju', 'cpu', 'xr', 'xrWarn', 'xrTop', 'xrSmall'];
export type JournalMetricField = (typeof JOURNAL_METRIC_FIELDS)[number];
export declare const JOURNAL_METRIC_DETAIL_FIELDS: readonly ["sci", "sciif", "sciUp", "sciUpSmall", "sciUpTop", "sciBase", "ssci", "jci", "sciif5", "ccf", "cssci", "cscd", "pku", "ei", "ahci", "sciwarn", "esi", "ajg", "fms", "udtd24", "ft50", "zhongguokejihexin", "swufe", "cufe", "uibe", "sdufe", "xdu", "swjtu", "ruc", "xmu", "sjtu", "fdu", "hhu", "scu", "cqu", "nju", "xju", "cug", "cju", "zju", "cpu", "xr", "xrWarn", "xrTop", "xrSmall", "custom"];
export type JournalMetricDetailField = (typeof JOURNAL_METRIC_DETAIL_FIELDS)[number];
export declare function journalMetricDetailFieldsOf(fields: readonly JournalMetricDetailField[]): ("ahci" | "ajg" | "ccf" | "cju" | "cpu" | "cqu" | "cscd" | "cssci" | "cufe" | "cug" | "custom" | "ei" | "esi" | "fdu" | "fms" | "ft50" | "hhu" | "jci" | "nju" | "pku" | "ruc" | "sci" | "sciBase" | "sciUp" | "sciUpSmall" | "sciUpTop" | "sciif" | "sciif5" | "sciwarn" | "scu" | "sdufe" | "sjtu" | "ssci" | "swjtu" | "swufe" | "udtd24" | "uibe" | "xdu" | "xju" | "xmu" | "xr" | "xrSmall" | "xrTop" | "xrWarn" | "zhongguokejihexin" | "zju")[];
export declare const DEFAULT_JOURNAL_METRIC_DETAIL_FIELDS: readonly ["sci", "sciif", "sciUp"];
export declare const JOURNAL_METRIC_LIST_CANDIDATES: readonly ["jcr", "sci", "sciif", "sciUp", "sciUpSmall", "sciUpTop", "sciBase", "ssci", "jci", "sciif5", "ccf", "cssci", "cscd", "pku", "ei", "ahci", "sciwarn", "esi", "ajg", "fms", "udtd24", "ft50", "zhongguokejihexin", "swufe", "cufe", "uibe", "sdufe", "xdu", "swjtu", "ruc", "xmu", "sjtu", "fdu", "hhu", "scu", "cqu", "nju", "xju", "cug", "cju", "zju", "cpu", "xr", "xrWarn", "xrTop", "xrSmall"];
export declare const JOURNAL_METRIC_LIST_PROFILES: readonly ['international', 'chineseCore'];
export declare const JOURNAL_METRIC_LIST_LIMITS: readonly [1, 2, 3];
export type JournalMetricListCandidate = (typeof JOURNAL_METRIC_LIST_CANDIDATES)[number];
export type JournalMetricListProfile = (typeof JOURNAL_METRIC_LIST_PROFILES)[number];
export interface JournalMetricListRules {
    readonly international: readonly JournalMetricListCandidate[];
    readonly chineseCore: readonly JournalMetricListCandidate[];
    readonly dualPriority: JournalMetricListProfile;
    readonly limit: (typeof JOURNAL_METRIC_LIST_LIMITS)[number];
}
export declare const DEFAULT_JOURNAL_METRIC_LIST: JournalMetricListRules;
export declare const EASYSCHOLAR_SECRET_KEY_REF = "EASYSCHOLAR_SECRET_KEY";
export declare const JOURNAL_NAME_MAX_LENGTH = 1024;
export declare const JOURNAL_METRIC_FAILURES: readonly ['credential', 'rateLimited', 'quotaExceeded', 'requestRejected', 'invalidResponse', 'serviceUnavailable', 'connectionFailed', 'timedOut', 'unavailable'];
export type JournalMetricFailure = (typeof JOURNAL_METRIC_FAILURES)[number];
export declare function isJournalMetricListRules(value: unknown): value is JournalMetricListRules;
/** Resolve a saved single-order profile or an existing rule set into list rules. */
export declare function journalMetricListRulesOf(value: unknown): JournalMetricListRules | undefined;
export declare function journalMetricListValues(official: readonly {
    readonly field: string;
    readonly value: string;
}[], rules: JournalMetricListRules, compact: boolean): {
    field: JournalMetricField;
    value: string;
}[];
export declare function isJournalMetricDetailFields(value: unknown): value is readonly JournalMetricDetailField[];
export declare function journalNameOf(value: unknown): string | undefined;
//# sourceMappingURL=journal-metrics.d.ts.map