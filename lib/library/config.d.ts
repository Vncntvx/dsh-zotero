/** Host authority for the panel's profile-wide, volatile preferences. */
import type { Volatile } from '@deepseek-ai/cordis';
import Schema from '@deepseek-ai/schemastery';
import { type LibraryPreferences } from '../library-preferences.js';
export type LibraryConfig = {
    [K in keyof LibraryPreferences]?: LibraryPreferences[K] | Volatile<LibraryPreferences[K]>;
};
export declare const LibraryConfigSchema: Schema<Schemastery.ObjectS<NoInfer<{
    rightSidebarEnabled: Schema<boolean, boolean, "volatile-defined">;
    listDensity: Schema<string | number, string | number, "volatile-defined">;
    titleLines: Schema<string | number, string | number, "volatile-defined">;
    detailExpandedSections: Schema<NoInfer<(string | number)[]>, NoInfer<(string | number)[]>, "volatile-defined">;
    localPdfOpenTarget: Schema<string | number, string | number, "volatile-defined">;
    urlPdfOpenTarget: Schema<string | number, string | number, "volatile-defined">;
    allowUrlPdfRead: Schema<boolean, boolean, "volatile-defined">;
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
    reopenBehavior: Schema<string | number, string | number, "volatile-defined">;
    scopeChangeBehavior: Schema<string | number, string | number, "volatile-defined">;
    defaultCopyFormat: Schema<string | number, string | number, "volatile-defined">;
    chatInsertContent: Schema<string | number, string | number, "volatile-defined">;
}>>, "plain">;
export declare function resolveLibraryConfig(config: LibraryConfig): LibraryPreferences;
//# sourceMappingURL=config.d.ts.map