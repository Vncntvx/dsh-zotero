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
import Schema from '@deepseek-ai/schemastery';
export const LibraryConfigSchema = Schema.object({
    rightSidebarEnabled: Schema.boolean()
        .default(true)
        .description('在右侧边栏显示文献面板标签页与快捷入口，支持边对话边查阅文献。')
        .volatile(),
});
//# sourceMappingURL=config.js.map