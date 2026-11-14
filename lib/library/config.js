import { isVolatile } from '@deepseek-ai/cosmokit';
import Schema from '@deepseek-ai/schemastery';
import { LIBRARY_CHOICES, LIBRARY_DEFAULTS, LIBRARY_PREFERENCE_KEYS, LIBRARY_SECTIONS, libraryPreferencesOf, } from '../library-preferences.js';
const choices = (values) => Schema.union(values.map((value) => Schema.const(value)));
export const LibraryConfigSchema = Schema.object({
    rightSidebarEnabled: Schema.boolean()
        .default(true)
        .description('显示文献面板与快捷入口。')
        .volatile(),
    listDensity: choices(LIBRARY_CHOICES.listDensity)
        .default(LIBRARY_DEFAULTS.listDensity)
        .description('列表信息密度。')
        .volatile(),
    titleLines: choices(LIBRARY_CHOICES.titleLines)
        .default(2)
        .description('文献标题最大行数。')
        .volatile(),
    detailExpandedSections: Schema.array(choices(LIBRARY_SECTIONS))
        .default([...LIBRARY_DEFAULTS.detailExpandedSections])
        .description('默认展开的详情分区，空数组表示全部折叠。')
        .volatile(),
    localPdfOpenTarget: choices(LIBRARY_CHOICES.localPdfOpenTarget)
        .default('sidebar')
        .description('本地 PDF 打开位置。')
        .volatile(),
    urlPdfOpenTarget: choices(LIBRARY_CHOICES.urlPdfOpenTarget)
        .default('sidebar')
        .description('URL PDF 打开位置。')
        .volatile(),
    allowUrlPdfRead: Schema.boolean()
        .default(false)
        .description('允许用户主动下载库内 URL PDF；会联系来源网站，当前 profile 的客户端共享此授权。')
        .volatile(),
    reopenBehavior: choices(LIBRARY_CHOICES.reopenBehavior)
        .default('restore')
        .description('新建或刷新恢复面板时的浏览位置。')
        .volatile(),
    scopeChangeBehavior: choices(LIBRARY_CHOICES.scopeChangeBehavior)
        .default('preserve')
        .description('切换合集时保留或清除搜索条件。')
        .volatile(),
    defaultCopyFormat: choices(LIBRARY_CHOICES.defaultCopyFormat)
        .default('citation')
        .description('主复制按钮使用的格式。')
        .volatile(),
    chatInsertContent: choices(LIBRARY_CHOICES.chatInsertContent)
        .default('reference')
        .description('插入对话的条目上下文。')
        .volatile(),
});
export function resolveLibraryConfig(config) {
    const raw = {};
    for (const key of LIBRARY_PREFERENCE_KEYS) {
        const value = config[key];
        if (value !== undefined)
            raw[key] = isVolatile(value) ? value.get() : value;
    }
    return libraryPreferencesOf(raw);
}
//# sourceMappingURL=config.js.map