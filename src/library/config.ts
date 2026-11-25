/** Host authority for the panel's profile-wide, volatile preferences. */
import type { Volatile } from '@deepseek-ai/cordis'
import { isVolatile } from '@deepseek-ai/cosmokit'
import Schema from '@deepseek-ai/schemastery'
import {
  JOURNAL_METRIC_DETAIL_FIELDS,
  JOURNAL_METRIC_FIELDS,
  JOURNAL_METRIC_LIST_CANDIDATES,
  JOURNAL_METRIC_LIST_LIMITS,
  JOURNAL_METRIC_LIST_PROFILES,
  type JournalMetricField,
  type JournalMetricListRules,
} from '../journal-metrics.js'
import {
  LIBRARY_CHOICES,
  LIBRARY_DEFAULTS,
  LIBRARY_PREFERENCE_KEYS,
  LIBRARY_SECTIONS,
  libraryPreferencesOf,
  type LibraryPreferences,
} from '../library-preferences.js'

type StoredLibraryPreferences = Omit<LibraryPreferences, 'journalMetricListOrder'> & {
  journalMetricListOrder: JournalMetricListRules | readonly JournalMetricField[]
}
export type LibraryConfig = {
  [K in keyof StoredLibraryPreferences]?:
    StoredLibraryPreferences[K] | Volatile<StoredLibraryPreferences[K]>
}
const choices = (values: readonly (string | number)[]) =>
  Schema.union(values.map((value) => Schema.const(value)))
export const LibraryConfigSchema = Schema.object({
  rightSidebarEnabled: Schema.boolean()
    .default(LIBRARY_DEFAULTS.rightSidebarEnabled)
    .description('显示文献面板与快捷入口。')
    .volatile(),
  listDensity: choices(LIBRARY_CHOICES.listDensity)
    .default(LIBRARY_DEFAULTS.listDensity)
    .description('列表信息密度。')
    .volatile(),
  titleLines: choices(LIBRARY_CHOICES.titleLines)
    .default(LIBRARY_DEFAULTS.titleLines)
    .description('文献标题最大行数。')
    .volatile(),
  detailExpandedSections: Schema.array(choices(LIBRARY_SECTIONS))
    .default([...LIBRARY_DEFAULTS.detailExpandedSections])
    .description('默认展开的详情分区，空数组表示全部折叠。')
    .volatile(),
  localPdfOpenTarget: choices(LIBRARY_CHOICES.localPdfOpenTarget)
    .default(LIBRARY_DEFAULTS.localPdfOpenTarget)
    .description('本地 PDF 打开位置。')
    .volatile(),
  urlPdfOpenTarget: choices(LIBRARY_CHOICES.urlPdfOpenTarget)
    .default(LIBRARY_DEFAULTS.urlPdfOpenTarget)
    .description('URL PDF 打开位置。')
    .volatile(),
  allowUrlPdfRead: Schema.boolean()
    .default(LIBRARY_DEFAULTS.allowUrlPdfRead)
    .description('允许用户主动下载库内 URL PDF；会联系来源网站，当前 profile 的客户端共享此授权。')
    .volatile(),
  journalMetricsEnabled: Schema.boolean()
    .default(LIBRARY_DEFAULTS.journalMetricsEnabled)
    .description('浏览文献面板时按期刊名向 EasyScholar 查询指标。')
    .volatile(),
  easyScholarSecretKeyRef: Schema.string()
    .role('credential-ref')
    .default(LIBRARY_DEFAULTS.easyScholarSecretKeyRef)
    .description('EasyScholar 的宿主凭据引用名。')
    .volatile(),
  journalMetricListOrder: Schema.union([
    Schema.object({
      international: Schema.array(choices(JOURNAL_METRIC_LIST_CANDIDATES)).required(),
      chineseCore: Schema.array(choices(JOURNAL_METRIC_LIST_CANDIDATES)).required(),
      dualPriority: choices(JOURNAL_METRIC_LIST_PROFILES).required(),
      limit: choices(JOURNAL_METRIC_LIST_LIMITS).required(),
    }),
    Schema.array(choices(JOURNAL_METRIC_FIELDS)),
  ])
    .default({
      ...LIBRARY_DEFAULTS.journalMetricListOrder,
      international: [...LIBRARY_DEFAULTS.journalMetricListOrder.international],
      chineseCore: [...LIBRARY_DEFAULTS.journalMetricListOrder.chineseCore],
    })
    .description('条目列表的国际索引与中文核心候选、双收录优先规则和展示上限。')
    .volatile(),
  journalMetricDetailFields: Schema.array(choices(JOURNAL_METRIC_DETAIL_FIELDS))
    .default([...LIBRARY_DEFAULTS.journalMetricDetailFields])
    .description('条目详情信息区展示的期刊指标。')
    .volatile(),
  reopenBehavior: choices(LIBRARY_CHOICES.reopenBehavior)
    .default(LIBRARY_DEFAULTS.reopenBehavior)
    .description('新建或刷新恢复面板时的浏览位置。')
    .volatile(),
  scopeChangeBehavior: choices(LIBRARY_CHOICES.scopeChangeBehavior)
    .default(LIBRARY_DEFAULTS.scopeChangeBehavior)
    .description('切换合集时保留或清除搜索条件。')
    .volatile(),
  defaultCopyFormat: choices(LIBRARY_CHOICES.defaultCopyFormat)
    .default(LIBRARY_DEFAULTS.defaultCopyFormat)
    .description('主复制按钮使用的格式。')
    .volatile(),
  chatInsertContent: choices(LIBRARY_CHOICES.chatInsertContent)
    .default(LIBRARY_DEFAULTS.chatInsertContent)
    .description('插入对话的条目上下文。')
    .volatile(),
})

export function resolveLibraryConfig(config: LibraryConfig): LibraryPreferences {
  const raw: Record<string, unknown> = {}
  for (const key of LIBRARY_PREFERENCE_KEYS) {
    const value = config[key]
    if (value !== undefined) raw[key] = isVolatile(value) ? value.get() : value
  }
  return libraryPreferencesOf(raw)
}
