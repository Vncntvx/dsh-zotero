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
  | 'groupWeb'
  | 'webEnabled'
  | 'webEnabledHint'
  | 'copy'
  | 'copied'
  | 'checking'
  | 'statusUnavailable'
  | 'inspectLabel'
  | 'referenceMismatch'
  | 'browse'
  | 'resultsCount'
  | 'moreOmitted'
  | 'scopeLibraryMetadata'
  | 'scopeLibraryEverything'
  | 'scopeCollection'
  | 'scopeSavedSearch'
  | 'personalNotes'
  | 'personalAnnotations'
  | 'evidencePassages'
  | 'evidenceSources'
  | 'sourceAnnotation'
  | 'sourceNote'
  | 'sourceAbstract'
  | 'sourceFulltext'
  | 'pageLabel'
  | 'truncatedMore'
  | 'truncatedPreview'
  | 'evidenceExpandLabel'
  | 'evidenceCollapseLabel'
  | 'localFile'
  | 'linkedUrl'
  | 'citationsCount'
  | 'refsRequested'
  | 'toolSearchTitle'
  | 'toolGetTitle'
  | 'toolRetrieveTitle'
  | 'toolAttachmentTitle'
  | 'toolExportTitle'
  | 'tagSearch'
  | 'tagGet'
  | 'tagRetrieve'
  | 'tagAttachment'
  | 'tagExport'
  | 'activityNote'
  | 'noActivity'
  | 'statusConnected'
  | 'apiVersionLabel'
  | 'schemaVersionLabel'
  | 'serverIdLabel'
  | 'diagnosisLabel'
  | 'refresh'
  | 'lastCheckedLabel'
  | 'lensItems'
  | 'lensCitations'
  | 'lensActivity'
  | 'funnelSearched'
  | 'funnelRead'
  | 'funnelCited'
  | 'starterFind'
  | 'starterCite'
  | 'starterTidy'
  | 'starterFindTemplate'
  | 'starterCiteTemplate'
  | 'starterTidyTemplate'
  | 'itemsEmptyNote'
  | 'itemsSourceNote'
  | 'itemsProcessedNote'
  | 'itemsSourceOmittedNote'
  | 'badgeRead'
  | 'badgeCited'
  | 'badgePdf'
  | 'copyRef'
  | 'copyFullText'
  | 'copyCite'
  | 'askAboutItem'
  | 'askTemplate'
  | 'generateCitation'
  | 'citeTemplate'
  | 'exportsLabel'
  | 'quickAccessLabel'
  | 'noExportsHint'
  | 'artifactExpandLabel'
  | 'artifactCollapseLabel'

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
  groupWeb: 'Web view',
  webEnabled: 'Zotero conversation tab',
  webEnabledHint:
    'Shows a dedicated Zotero tab at the top of conversations (items, citations, activity). Turn it off to hide the tab.',
  copy: 'Copy',
  copied: 'Copied',
  checking: 'Checking…',
  statusUnavailable: 'Unavailable',
  inspectLabel: 'Inspect',
  referenceMismatch: 'This reference belongs to another Zotero database. Search again.',
  browse: 'Browse',
  resultsCount: '{count} results',
  moreOmitted: '{count} more in Inspect',
  scopeLibraryMetadata: 'Personal library · Metadata',
  scopeLibraryEverything: 'Personal library · Everything',
  scopeCollection: 'Collection · {name}',
  scopeSavedSearch: 'Saved search · {name}',
  personalNotes: 'Personal notes',
  personalAnnotations: 'Personal annotations',
  evidencePassages: '{count} evidence passages',
  evidenceSources: 'sources: {sources}',
  sourceAnnotation: 'Annotation',
  sourceNote: 'Note',
  sourceAbstract: 'Abstract',
  sourceFulltext: 'Full text',
  pageLabel: 'p.{label}',
  truncatedMore: 'more omitted',
  truncatedPreview: '(truncated)',
  evidenceExpandLabel: 'Expand preview',
  evidenceCollapseLabel: 'Collapse preview',
  localFile: 'Local file',
  linkedUrl: 'Linked URL',
  citationsCount: '{count} citations',
  refsRequested: '{count} refs',
  toolSearchTitle: 'Search Zotero library',
  toolGetTitle: 'Read Zotero item',
  toolRetrieveTitle: 'Finding evidence',
  toolAttachmentTitle: 'Resolve Zotero attachment',
  toolExportTitle: 'Export Zotero citations',
  tagSearch: 'SEARCH',
  tagGet: 'DETAIL',
  tagRetrieve: 'EVIDENCE',
  tagAttachment: 'FILE',
  tagExport: 'EXPORT',
  activityNote: 'The session made {count} Zotero calls.',
  noActivity: 'No Zotero tool calls in this session yet.',
  statusConnected: 'Connected',
  apiVersionLabel: 'API version',
  schemaVersionLabel: 'Schema version',
  serverIdLabel: 'Server ID',
  diagnosisLabel: 'Diagnosis',
  refresh: 'Refresh',
  lastCheckedLabel: 'Last checked',
  lensItems: 'Items',
  lensCitations: 'Citations',
  lensActivity: 'Activity',
  funnelSearched: 'Searched {count}',
  funnelRead: 'Read {count}',
  funnelCited: 'Cited {count}',
  starterFind: 'Find literature…',
  starterCite: 'Citations (LaTeX)…',
  starterTidy: 'Tidy my library…',
  starterFindTemplate: 'Search my Zotero library for literature on: ',
  starterCiteTemplate:
    'Export the following items from my Zotero library as BibTeX for LaTeX citations: ',
  starterTidyTemplate:
    'Review my Zotero library and list items with missing metadata or broken attachments: ',
  itemsEmptyNote: 'No itemized literature in this session yet.',
  itemsSourceNote: 'Searches in this session returned {count} results; all are listed below.',
  itemsSourceOmittedNote:
    'Searches in this session returned {count} results; the first {shown} are listed.',
  itemsProcessedNote: 'Papers this session read, cited, or resolved an attachment for.',
  badgeRead: 'Read',
  badgeCited: 'Cited',
  badgePdf: 'PDF',
  copyRef: 'Copy ref',
  copyFullText: 'Copy full text',
  copyCite: '\\cite{…}',
  askAboutItem: 'Ask about this',
  askTemplate: 'About this item ({ref}): ',
  generateCitation: 'Generate citation',
  citeTemplate: 'Export this item from Zotero as BibTeX: {ref}',
  exportsLabel: 'Exported citations',
  quickAccessLabel: 'Quick access',
  noExportsHint:
    'No export artifacts in this session yet. Ask the agent to export selected items as BibTeX or CSL citations.',
  artifactExpandLabel: 'Expand body',
  artifactCollapseLabel: 'Collapse body',
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
  groupWeb: 'Web 视图',
  webEnabled: 'Zotero 会话标签页',
  webEnabledHint: '在会话顶部显示 Zotero 专属标签页，包含文献、引用与活动；关闭后该标签页隐藏。',
  copy: '复制',
  copied: '已复制',
  checking: '检查中…',
  statusUnavailable: '不可用',
  inspectLabel: 'Inspect',
  referenceMismatch: '此 ref 属于另一个 Zotero 数据库，请重新搜索。',
  browse: '浏览',
  resultsCount: '{count} results',
  moreOmitted: '另有 {count} 条，见 Inspect',
  scopeLibraryMetadata: 'Personal library · Metadata',
  scopeLibraryEverything: 'Personal library · Everything',
  scopeCollection: 'Collection · {name}',
  scopeSavedSearch: 'Saved search · {name}',
  personalNotes: '个人笔记',
  personalAnnotations: '个人批注',
  evidencePassages: '{count} evidence passages',
  evidenceSources: 'sources: {sources}',
  sourceAnnotation: 'Annotation',
  sourceNote: 'Note',
  sourceAbstract: 'Abstract',
  sourceFulltext: 'Full text',
  pageLabel: 'p.{label}',
  truncatedMore: '另有省略',
  truncatedPreview: '(截断)',
  evidenceExpandLabel: '展开预览',
  evidenceCollapseLabel: '收起预览',
  localFile: 'Local file',
  linkedUrl: 'Linked URL',
  citationsCount: '{count} citations',
  refsRequested: '{count} refs',
  toolSearchTitle: 'Search Zotero library',
  toolGetTitle: 'Read Zotero item',
  toolRetrieveTitle: 'Finding evidence',
  toolAttachmentTitle: 'Resolve Zotero attachment',
  toolExportTitle: 'Export Zotero citations',
  tagSearch: '检索',
  tagGet: '详情',
  tagRetrieve: '证据',
  tagAttachment: '附件',
  tagExport: '导出',
  activityNote: '本会话共 {count} 次 Zotero 调用。',
  noActivity: '本会话还没有 Zotero 工具调用。',
  statusConnected: '已连接',
  apiVersionLabel: 'API 版本',
  schemaVersionLabel: 'Schema 版本',
  serverIdLabel: 'Server ID',
  diagnosisLabel: '诊断',
  refresh: '刷新',
  lastCheckedLabel: '上次检查',
  lensItems: '文献',
  lensCitations: '引用',
  lensActivity: '活动',
  funnelSearched: '检索 {count}',
  funnelRead: '精读 {count}',
  funnelCited: '引用 {count}',
  starterFind: '找文献…',
  starterCite: '查引用（LaTeX）…',
  starterTidy: '整理我的库…',
  starterFindTemplate: '帮我在 Zotero 文献库里检索这个主题的文献：',
  starterCiteTemplate: '把下面几篇从我的 Zotero 库导出为 BibTeX，用于 LaTeX 引用：',
  starterTidyTemplate: '帮我检查 Zotero 库，列出元数据缺失或附件有问题的条目：',
  itemsEmptyNote: '本会话还没有可按篇展示的文献结果。',
  itemsSourceNote: '本会话检索命中 {count} 条，以下全部列出。',
  itemsSourceOmittedNote: '本会话检索命中 {count} 条，此处列出前 {shown} 条。',
  itemsProcessedNote: '本会话精读、引用或查过附件的文献。',
  badgeRead: '精读',
  badgeCited: '引用',
  badgePdf: 'PDF',
  copyRef: '复制 ref',
  copyFullText: '复制全文',
  copyCite: '\\cite{…}',
  askAboutItem: '问这篇',
  askTemplate: '关于这篇文献（{ref}）：',
  generateCitation: '生成引用',
  citeTemplate: '把这篇文献从 Zotero 导出为 BibTeX：{ref}',
  exportsLabel: '本会话导出的引用',
  quickAccessLabel: '快速取用',
  noExportsHint: '本会话还没有导出产物。可以让 agent 把选中的文献导出为 BibTeX 或 CSL 引用。',
  artifactExpandLabel: '展开全文',
  artifactCollapseLabel: '收起全文',
}
