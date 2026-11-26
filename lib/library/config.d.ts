/** Host authority for the panel's profile-wide, volatile preferences. */
import type { Volatile } from '@deepseek-ai/cordis';
import Schema from '@deepseek-ai/schemastery';
import { type JournalMetricField, type JournalMetricListRules } from '../journal-metrics.js';
import { type LibraryPreferences } from '../library-preferences.js';
type StoredLibraryPreferences = Omit<LibraryPreferences, 'journalMetricListOrder'> & {
    journalMetricListOrder: JournalMetricListRules | readonly JournalMetricField[];
};
export type LibraryConfig = {
    [K in keyof StoredLibraryPreferences]?: StoredLibraryPreferences[K] | Volatile<StoredLibraryPreferences[K]>;
};
export declare const LibraryConfigSchema: Schema<Schemastery.ObjectS<NoInfer<{
    rightSidebarEnabled: Schema<boolean, boolean, "volatile-defined">;
    listDensity: Schema<string | number, string | number, "volatile-defined">;
    titleLines: Schema<string | number, string | number, "volatile-defined">;
    detailExpandedSections: Schema<NoInfer<(string | number)[]>, NoInfer<(string | number)[]>, "volatile-defined">;
    localPdfOpenTarget: Schema<string | number, string | number, "volatile-defined">;
    urlPdfOpenTarget: Schema<string | number, string | number, "volatile-defined">;
    allowUrlPdfRead: Schema<boolean, boolean, "volatile-defined">;
    journalMetricsEnabled: Schema<boolean, boolean, "volatile-defined">;
    easyScholarSecretKeyRef: Schema<string, string, "volatile-defined">;
    journalMetricListOrder: Schema<NoInfer<(string | number)[] | ({
        international?: (string | number)[] | null | undefined;
        chineseCore?: (string | number)[] | null | undefined;
        dualPriority?: string | number | null | undefined;
        limit?: string | number | null | undefined;
    } & import("@deepseek-ai/cosmokit").Dict)>, NoInfer<(string | number)[] | Schemastery.ObjectT<NoInfer<{
        international: Schema<(string | number)[], (string | number)[], "defined">;
        chineseCore: Schema<(string | number)[], (string | number)[], "defined">;
        dualPriority: Schema<string | number, string | number, "defined">;
        limit: Schema<string | number, string | number, "defined">;
    }>>>, "volatile-defined">;
    journalMetricDetailFields: Schema<NoInfer<(string | number)[]>, NoInfer<(string | number)[]>, "volatile-defined">;
    reopenBehavior: Schema<string | number, string | number, "volatile-defined">;
    scopeChangeBehavior: Schema<string | number, string | number, "volatile-defined">;
    defaultCopyFormat: Schema<string | number, string | number, "volatile-defined">;
    chatInsertContent: Schema<string | number, string | number, "volatile-defined">;
}>>, Schemastery.ObjectT<NoInfer<{
    rightSidebarEnabled: Schema<boolean, boolean, "volatile-defined">;
    listDensity: Schema<string | number, string | number, "volatile-defined">;
    titleLines: Schema<string | number, string | number, "volatile-defined">;
    detailExpandedSections: Schema<NoInfer<(string | number)[]>, NoInfer<(string | number)[]>, "volatile-defined">;
    localPdfOpenTarget: Schema<string | number, string | number, "volatile-defined">;
    urlPdfOpenTarget: Schema<string | number, string | number, "volatile-defined">;
    allowUrlPdfRead: Schema<boolean, boolean, "volatile-defined">;
    journalMetricsEnabled: Schema<boolean, boolean, "volatile-defined">;
    easyScholarSecretKeyRef: Schema<string, string, "volatile-defined">;
    journalMetricListOrder: Schema<NoInfer<(string | number)[] | ({
        international?: (string | number)[] | null | undefined;
        chineseCore?: (string | number)[] | null | undefined;
        dualPriority?: string | number | null | undefined;
        limit?: string | number | null | undefined;
    } & import("@deepseek-ai/cosmokit").Dict)>, NoInfer<(string | number)[] | Schemastery.ObjectT<NoInfer<{
        international: Schema<(string | number)[], (string | number)[], "defined">;
        chineseCore: Schema<(string | number)[], (string | number)[], "defined">;
        dualPriority: Schema<string | number, string | number, "defined">;
        limit: Schema<string | number, string | number, "defined">;
    }>>>, "volatile-defined">;
    journalMetricDetailFields: Schema<NoInfer<(string | number)[]>, NoInfer<(string | number)[]>, "volatile-defined">;
    reopenBehavior: Schema<string | number, string | number, "volatile-defined">;
    scopeChangeBehavior: Schema<string | number, string | number, "volatile-defined">;
    defaultCopyFormat: Schema<string | number, string | number, "volatile-defined">;
    chatInsertContent: Schema<string | number, string | number, "volatile-defined">;
}>>, "plain">;
export declare function resolveLibraryConfig(config: LibraryConfig): LibraryPreferences;
export {};
//# sourceMappingURL=config.d.ts.map