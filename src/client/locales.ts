/** Locale bundles for the Zotero settings page. */

import type { FieldKey, GroupKey } from './zotero-card-controller.ts'

/** Locale keys the page renders: fixed chrome keys plus the field table's keys, labels, and groups. */
export type ZoteroLocaleKey =
  | 'nav'
  | 'title'
  | 'description'
  | 'loading'
  | 'unavailable'
  | 'overridden'
  | 'reset'
  | 'readOnly'
  | 'save'
  | 'saving'
  | 'saveFailed'
  | 'invalidNumber'
  | GroupKey
  | FieldKey
  | `${FieldKey}Hint`

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Zotero settings page copy. */
    zotero: ZoteroLocaleKey
  }
}

/** English copy. */
export const en: Record<ZoteroLocaleKey, string> = {
  nav: 'Zotero',
  title: 'Zotero',
  description: 'Access to your local Zotero library.',
  loading: 'Loading settings…',
  unavailable:
    'Settings are unavailable: this deployment composes no settings document for Zotero.',
  overridden: 'Overridden',
  reset: 'Reset to default',
  readOnly: 'This deployment stores settings read-only.',
  save: 'Save',
  saving: 'Saving…',
  saveFailed: 'The deployment did not accept these values; they were left for you to correct.',
  invalidNumber: 'Enter a number, or leave blank to use the default.',
  groupConnection: 'Connection',
  groupSearch: 'Search limits',
  groupOutput: 'Output limits',
  groupDefaults: 'Export defaults',
  baseUrl: 'Local API base URL',
  baseUrlHint: 'Must be a loopback HTTP address (127.0.0.1, localhost, or ::1).',
  provider: 'Provider id',
  providerHint: 'The registered provider to serve requests; the built-in one is local.',
  timeoutMs: 'Request timeout (ms)',
  timeoutMsHint: 'Per-request provider deadline in milliseconds.',
  maxSearchResults: 'Search result cap',
  maxSearchResultsHint: 'Upper bound for the limit zotero_search accepts in one call.',
  maxNoteScanRecords: 'Note scan cap',
  maxNoteScanRecordsHint: 'Note records zotero_search scans for body matches.',
  maxEvidenceChars: 'Evidence character budget',
  maxEvidenceCharsHint: 'Total character budget for retrieved evidence passages.',
  maxEvidencePassages: 'Evidence passage cap',
  maxEvidencePassagesHint: 'Upper bound for the passages zotero_retrieve returns.',
  maxDetailChars: 'Detail preview budget',
  maxDetailCharsHint: 'Character budget for the zotero_get abstract preview.',
  maxNoteBodyChars: 'Note body budget',
  maxNoteBodyCharsHint: 'Character budget for a note item’s own body in zotero_get.',
  maxNoteChars: 'Note preview budget',
  maxNoteCharsHint: 'Per-note character budget for zotero_get note previews.',
  maxNoteRecords: 'Note record cap',
  maxNoteRecordsHint: 'Note records zotero_get returns at most.',
  maxAnnotationRecords: 'Annotation record cap',
  maxAnnotationRecordsHint: 'Annotation records zotero_get returns at most.',
  fulltextChunkWords: 'Full-text chunk words',
  fulltextChunkWordsHint: 'Word count of each full-text passage entering evidence ranking.',
  maxFulltextChars: 'Full-text character bound',
  maxFulltextCharsHint: 'Full text accepted into zotero_retrieve ranking at most.',
  maxResponseBytes: 'Response byte cap',
  maxResponseBytesHint: 'Streaming byte bound for every API response body.',
  maxExportChars: 'Export character cap',
  maxExportCharsHint: 'Provider hard limit for zotero_export output.',
  maxExportRefs: 'Export ref cap',
  maxExportRefsHint: 'Refs one zotero_export call accepts at most.',
  defaultStyle: 'Default citation style',
  defaultStyleHint: 'CSL style id for citation and bibliography formats (e.g. apa).',
  defaultLocale: 'Default locale',
  defaultLocaleHint: 'CSL locale for citation and bibliography formats (e.g. en-US).',
}

/** Simplified Chinese copy. */
export const zh: Record<ZoteroLocaleKey, string> = {
  nav: 'Zotero',
  title: 'Zotero',
  description: '本地 Zotero 文献库的接入配置。',
  loading: '正在加载设置…',
  unavailable: '设置不可用：本部署未为 Zotero 组合设置文档。',
  overridden: '已覆盖',
  reset: '恢复默认',
  readOnly: '本部署的设置为只读。',
  save: '保存',
  saving: '保存中…',
  saveFailed: '本部署没有接受这些值，已保留供你修改。',
  invalidNumber: '请填数字；留空表示使用默认值。',
  groupConnection: '连接',
  groupSearch: '检索限制',
  groupOutput: '输出限制',
  groupDefaults: '导出默认',
  baseUrl: 'Local API 地址',
  baseUrlHint: '仅允许本机回环 HTTP 地址（127.0.0.1、localhost 或 ::1）。',
  provider: '提供方 ID',
  providerHint: '处理请求的已注册提供方；内置提供方为 local。',
  timeoutMs: '请求超时（毫秒）',
  timeoutMsHint: '每个请求的提供方截止时间。',
  maxSearchResults: '搜索返回上限',
  maxSearchResultsHint: 'zotero_search 单次调用接受的 limit 上限。',
  maxNoteScanRecords: '笔记扫描上限',
  maxNoteScanRecordsHint: 'zotero_search 为正文匹配扫描的笔记记录数上限。',
  maxEvidenceChars: '证据字符预算',
  maxEvidenceCharsHint: 'zotero_retrieve 检索到的证据段落总字符预算。',
  maxEvidencePassages: '证据段落上限',
  maxEvidencePassagesHint: 'zotero_retrieve 返回的段落数量上限。',
  maxDetailChars: '详情摘要预算',
  maxDetailCharsHint: 'zotero_get 摘要预览的字符预算。',
  maxNoteBodyChars: '笔记正文预算',
  maxNoteBodyCharsHint: 'zotero_get 返回笔记条目自身正文的字符预算。',
  maxNoteChars: '笔记预览预算',
  maxNoteCharsHint: 'zotero_get 每条笔记预览的字符预算。',
  maxNoteRecords: '笔记记录上限',
  maxNoteRecordsHint: 'zotero_get 最多返回的笔记记录数。',
  maxAnnotationRecords: '批注记录上限',
  maxAnnotationRecordsHint: 'zotero_get 最多返回的批注记录数。',
  fulltextChunkWords: '全文分块词数',
  fulltextChunkWordsHint: '进入证据排序的每个全文分块的词数。',
  maxFulltextChars: '全文字符上限',
  maxFulltextCharsHint: 'zotero_retrieve 最多接受进入排序的全文字符数。',
  maxResponseBytes: '响应体上限（字节）',
  maxResponseBytesHint: '每个 API 响应体的流式字节上限。',
  maxExportChars: '导出字符上限',
  maxExportCharsHint: 'zotero_export 输出的提供方硬上限。',
  maxExportRefs: '导出条目上限',
  maxExportRefsHint: 'zotero_export 单次调用最多接受的 refs 数。',
  defaultStyle: '默认引文样式',
  defaultStyleHint: 'citation/bibliography 格式的 CSL 样式 id（如 apa）。',
  defaultLocale: '默认区域设置',
  defaultLocaleHint: 'citation/bibliography 格式的 CSL locale（如 en-US）。',
}
