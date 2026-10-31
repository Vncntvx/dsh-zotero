/**
 * Configuration schema for the Zotero library panel subsystem: the right
 * sidebar tab toggle, volatile.
 *
 * The schema is the configuration's single authority: the loader validates the
 * row config against it and resolves its volatile defaults, and the browser's
 * settings form reads the same section through the `library` namespace. The
 * host service itself reads no field — the switch lives entirely in the
 * browser's surface gating.
 *
 * @module dsh-zotero/library/config
 */
import type { Volatile } from '@deepseek-ai/cordis';
import Schema from '@deepseek-ai/schemastery';
export interface LibraryConfig {
    rightSidebarEnabled?: Volatile<boolean> | boolean;
}
export declare const LibraryConfigSchema: Schema<Schemastery.ObjectS<NoInfer<{
    rightSidebarEnabled: Schema<boolean, boolean, "volatile-defined">;
}>>, Schemastery.ObjectT<NoInfer<{
    rightSidebarEnabled: Schema<boolean, boolean, "volatile-defined">;
}>>, "plain">;
//# sourceMappingURL=config.d.ts.map