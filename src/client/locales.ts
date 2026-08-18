/**
 * Locale bundles for the Zotero plugin: the Settings card (fixed chrome,
 * groups, and the field table) and the Sources panel. Both dictionaries are
 * typed `Record<ZoteroLocaleKey, string>`, so the key sets cannot drift; the
 * wording stays provable — no stage claims (精读/已引用) anywhere.
 */

import type { FieldKey, GroupKey } from './zotero-card-controller.ts'

/** Locale keys the plugin renders: settings chrome, field table keys, and panel copy. */
export type ZoteroLocaleKey =
  | 'nav'
  | 'title'
  | 'description'
  | 'overridden'
  | 'reset'
  | 'readOnly'
  | 'discard'
  | 'unsaved'
  | 'expand'
  | 'collapse'
  | 'save'
  | 'saving'
  | 'saveFailed'
  | 'invalidNumber'
  | GroupKey
  | FieldKey
  | `${FieldKey}Hint`
  | 'copy'
  | 'copied'
  | 'checking'
  | 'statusUnavailable'
  | 'statusConnectedNote'
  | 'detailsLabel'
  | 'apiVersionLabel'
  | 'schemaVersionLabel'
  | 'serverIdLabel'
  | 'buildInfoLabel'
  | 'diagnosisLabel'
  | 'refresh'
  | 'lastCheckedLabel'
  | 'lensSources'
  | 'lensExports'
  | 'panelOverview'
  | 'panelEvidence'
  | 'panelExports'
  | 'backToList'
  | 'selectionHiddenNote'
  | 'inspectorEmptyNote'
  | 'scopeLine'
  | 'filterLine'
  | 'modeLine'
  | 'modeMetadata'
  | 'modeEverything'
  | 'overviewScopeLibrary'
  | 'overviewScopeCollection'
  | 'overviewScopeSavedSearch'
  | 'searchDetailOpen'
  | 'searchDetailClose'
  | 'refLine'
  | 'moreActions'
  | 'overviewNoSearch'
  | 'retrievalRunCount'
  | 'retrievalKeptCount'
  | 'retrievalReportedCount'
  | 'availabilityTitle'
  | 'evidenceEntryLabel'
  | 'backToSources'
  | 'downloadArtifact'
  | 'filterAll'
  | 'filterPdf'
  | 'filterRetrieved'
  | 'filterEvidence'
  | 'filterExported'
  | 'filterIssues'
  | 'filterClear'
  | 'filterEmptyNote'
  | 'filterScrollLeft'
  | 'filterScrollRight'
  | 'omittedRowsNote'
  | 'noSources'
  | 'searchFrom'
  | 'searchFromBrowse'
  | 'provenanceMismatch'
  | 'evidenceBadge'
  | 'exportBadge'
  | 'failedBadge'
  | 'runningBadge'
  | 'stoppedBadge'
  | 'badgePdf'
  | 'issuesBadge'
  | 'bestAttachmentLabel'
  | 'localFile'
  | 'linkedUrl'
  | 'copyRef'
  | 'copyExport'
  | 'copyCite'
  | 'copyAll'
  | 'downloadAll'
  | 'unresolvedItemsNote'
  | 'downloadFull'
  | 'askAboutItem'
  | 'askTemplate'
  | 'citeTemplate'
  | 'exportCitation'
  | 'sourceAnnotation'
  | 'sourceNote'
  | 'sourceAbstract'
  | 'sourceFulltext'
  | 'pageLabel'
  | 'truncatedPreview'
  | 'retrievedMultiple'
  | 'coverageLabel'
  | 'coveragePages'
  | 'coverageChars'
  | 'coverageComplete'
  | 'coverageIncomplete'
  | 'budgetLimitedNote'
  | 'availReturned'
  | 'availUnavailable'
  | 'availNoMatch'
  | 'evidenceRetrievedNone'
  | 'evidenceNotRetrieved'
  | 'evidenceReportedNoPreview'
  | 'evidenceEmptyNote'
  | 'exportsEmptyNote'
  | 'exportsIncompleteNote'
  | 'formatCitation'
  | 'formatBibliography'
  | 'formatUnknown'
  | 'exportRefCount'
  | 'exportRefsOmitted'
  | 'openInZotero'
  | 'openPdf'
  | 'openAnnotation'
  | 'instanceUnverified'
  | 'openUnverifiedNote'
  | 'availabilityEntry'
  | 'starterFind'
  | 'starterFindTemplate'
  | 'starterCompare'
  | 'starterCompareTemplate'
  | 'starterEvidence'
  | 'starterEvidenceTemplate'
  | 'starterExportSelected'
  | 'starterExportSelectedTemplate'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Zotero plugin copy. */
    zotero: ZoteroLocaleKey
  }
}

/** English copy. */
export const en: Record<ZoteroLocaleKey, string> = {
  nav: 'Zotero',
  title: 'Zotero',
  description: 'Access to your Zotero library.',
  overridden: 'Overridden',
  reset: 'Reset to default',
  readOnly: 'This deployment stores settings read-only.',
  discard: 'Discard changes',
  unsaved: 'Unsaved',
  expand: 'Show settings',
  collapse: 'Hide settings',
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
  maxEvidenceChars: 'Passage character budget',
  maxEvidenceCharsHint: 'Total character budget for retrieved passages.',
  maxEvidencePassages: 'Passage cap',
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
  fulltextChunkWordsHint: 'Word count of each full-text passage entering passage ranking.',
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
  groupWeb: 'Literature panel',
  webEnabled: 'Zotero literature tab',
  webEnabledHint:
    'Shows a dedicated Zotero tab at the top of conversations (literature, passages, exports). Turning it off hides the tab right away.',
  copy: 'Copy',
  copied: 'Copied',
  checking: 'Checking…',
  statusUnavailable: 'Unavailable',
  statusConnectedNote: 'Connected to Zotero',
  detailsLabel: 'Diagnostics',
  apiVersionLabel: 'API version',
  schemaVersionLabel: 'Schema version',
  serverIdLabel: 'Server ID',
  buildInfoLabel: 'Build',
  diagnosisLabel: 'Diagnosis',
  refresh: 'Refresh',
  lastCheckedLabel: 'Last checked',
  lensSources: 'Literature',
  lensExports: 'Exports',
  panelOverview: 'Overview',
  panelEvidence: 'Passages',
  panelExports: 'Exports',
  backToList: 'Back to list',
  selectionHiddenNote:
    'This source is hidden by the active filter; the details stay available here.',
  inspectorEmptyNote: 'Select a source to see its details.',
  scopeLine: 'Scope',
  filterLine: 'Filters',
  modeLine: 'Mode',
  modeMetadata: 'Metadata',
  modeEverything: 'Metadata and full text',
  overviewScopeLibrary: 'Library',
  overviewScopeCollection: 'Collection',
  overviewScopeSavedSearch: 'Saved search',
  searchDetailOpen: 'Search details',
  searchDetailClose: 'Hide search details',
  refLine: 'Ref',
  moreActions: 'More actions',
  overviewNoSearch: 'This source was referenced directly, not through a search.',
  retrievalRunCount: '{count} retrieves',
  retrievalKeptCount: '{count} passages kept',
  retrievalReportedCount: '{count} reported',
  availabilityTitle: 'Latest state of each retrieve source',
  evidenceEntryLabel: 'Passage overview ({count})',
  backToSources: 'Back to literature',
  downloadArtifact: 'Download',
  filterAll: 'All',
  filterPdf: 'PDF',
  filterRetrieved: 'Content retrieved',
  filterEvidence: 'With passages',
  filterExported: 'Exported',
  filterIssues: 'Issues',
  filterClear: 'Clear filter',
  filterEmptyNote: 'No sources match this filter.',
  filterScrollLeft: 'Scroll filters left',
  filterScrollRight: 'Scroll filters right',
  omittedRowsNote: '{count} more search results are not listed individually.',
  noSources: 'No Zotero papers in this session yet.',
  searchFrom: 'Search "{query}"',
  searchFromBrowse: 'Search without a query',
  provenanceMismatch: 'Belongs to a different Zotero database',
  evidenceBadge: '{count} passages',
  exportBadge: '{count} exports',
  failedBadge: '{count} failed',
  runningBadge: '{count} running',
  stoppedBadge: '{count} stopped',
  badgePdf: 'PDF',
  issuesBadge: 'Issues',
  bestAttachmentLabel: 'Best attachment',
  localFile: 'Local file',
  linkedUrl: 'Linked URL',
  copyRef: 'Copy ref',
  copyExport: 'Copy',
  copyCite: '\\cite{…}',
  copyAll: 'Copy all',
  downloadAll: 'Download all',
  unresolvedItemsNote: '{count} more documents cannot be shown individually',
  downloadFull: 'Download full',
  askAboutItem: 'Ask about this',
  askTemplate: 'About this item ({ref}): ',
  citeTemplate: 'Export this item from Zotero as BibTeX: {ref}',
  exportCitation: 'Export citation',
  sourceAnnotation: 'Annotation',
  sourceNote: 'Note',
  sourceAbstract: 'Abstract',
  sourceFulltext: 'Full text',
  pageLabel: 'p.{label}',
  truncatedPreview: '(truncated)',
  retrievedMultiple: 'gathered across {count} retrieves',
  coverageLabel: 'Indexing coverage',
  coveragePages: '{indexed}/{total} pages',
  coverageChars: '{indexed}/{total} chars',
  coverageComplete: ' · complete',
  coverageIncomplete: ' · incomplete',
  budgetLimitedNote: 'Results were limited by the global budget.',
  availReturned: '{count} matching passages',
  availUnavailable: 'unavailable',
  availNoMatch: 'no matching passages',
  evidenceRetrievedNone: 'No matching passages were found this time.',
  evidenceNotRetrieved:
    "This paper's content has not been retrieved yet. Ask the Agent about it and the matching passages will appear here.",
  evidenceReportedNoPreview: '{count} passages reported across retrieves; no previews were kept.',
  evidenceEmptyNote:
    'No passages yet. Ask the Agent about a paper and the abstracts, annotations, notes, or full-text passages it finds will appear here.',
  exportsEmptyNote: 'No successful exports in this session yet.',
  exportsIncompleteNote: 'Exports that did not complete: {counts}',
  formatCitation: 'Citations',
  formatBibliography: 'Bibliography',
  formatUnknown: 'Export',
  exportRefCount: '{count} refs',
  exportRefsOmitted: '{count} more not listed',
  openInZotero: 'Open in Zotero',
  openPdf: 'Open PDF',
  openAnnotation: 'Open annotation',
  instanceUnverified: 'cannot verify the current Zotero instance',
  openUnverifiedNote: ' ({detail})',
  availabilityEntry: '{source}: {detail}',
  starterFind: 'Find literature…',
  starterFindTemplate: 'Search my Zotero library for literature on: ',
  starterCompare: 'Compare selected papers…',
  starterCompareTemplate: 'Compare the following Zotero papers: ',
  starterEvidence: 'Find passages…',
  starterEvidenceTemplate: 'Find passages in this paper for the following question: ',
  starterExportSelected: 'Export citations for selected items…',
  starterExportSelectedTemplate: 'Export these items from my Zotero library as citations: ',
}

/** Simplified Chinese copy. */
export const zh: Record<ZoteroLocaleKey, string> = {
  nav: 'Zotero',
  title: 'Zotero',
  description: 'Zotero 文献库的接入配置。',
  overridden: '已覆盖',
  reset: '恢复默认',
  readOnly: '本部署的设置为只读。',
  discard: '放弃修改',
  unsaved: '未保存',
  expand: '展开设置',
  collapse: '收起设置',
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
  maxEvidenceChars: '片段字符预算',
  maxEvidenceCharsHint: 'zotero_retrieve 检索到的片段总字符预算。',
  maxEvidencePassages: '片段上限',
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
  fulltextChunkWordsHint: '进入片段排序的每个全文分块的词数。',
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
  groupWeb: '文献面板',
  webEnabled: 'Zotero 文献标签页',
  webEnabledHint:
    '在会话顶部显示 Zotero 文献标签页（文献、相关片段、导出）；关闭后标签页立即隐藏。',
  copy: '复制',
  copied: '已复制',
  checking: '检查中…',
  statusUnavailable: '不可用',
  statusConnectedNote: '已连接到 Zotero',
  detailsLabel: '诊断详情',
  apiVersionLabel: 'API 版本',
  schemaVersionLabel: 'Schema 版本',
  serverIdLabel: 'Server ID',
  buildInfoLabel: '构建',
  diagnosisLabel: '诊断',
  refresh: '刷新',
  lastCheckedLabel: '上次检查',
  lensSources: '文献',
  lensExports: '导出',
  panelOverview: '概览',
  panelEvidence: '相关片段',
  panelExports: '导出',
  backToList: '返回列表',
  selectionHiddenNote: '这篇文献在当前筛选下被隐藏；详情仍然保留在这里。',
  inspectorEmptyNote: '选择一篇文献查看详情。',
  scopeLine: '范围',
  filterLine: '筛选',
  modeLine: '模式',
  modeMetadata: '元数据',
  modeEverything: '元数据与全文',
  overviewScopeLibrary: '文献库',
  overviewScopeCollection: '合集',
  overviewScopeSavedSearch: '保存的检索',
  searchDetailOpen: '查看检索条件',
  searchDetailClose: '收起检索条件',
  refLine: 'ref',
  moreActions: '更多操作',
  overviewNoSearch: '这篇文献是直接引用的，不是通过检索获得。',
  retrievalRunCount: '检索 {count} 次',
  retrievalKeptCount: '保留 {count} 条',
  retrievalReportedCount: '报告 {count} 条',
  availabilityTitle: '最近一次各检索来源状态',
  evidenceEntryLabel: '片段总览 {count}',
  backToSources: '返回文献',
  downloadArtifact: '下载',
  filterAll: '全部',
  filterPdf: 'PDF',
  filterRetrieved: '已查',
  filterEvidence: '有片段',
  filterExported: '已导出',
  filterIssues: '异常',
  filterClear: '清除筛选',
  filterEmptyNote: '这个筛选条件下没有文献。',
  filterScrollLeft: '向左滚动筛选',
  filterScrollRight: '向右滚动筛选',
  omittedRowsNote: '另有 {count} 条检索结果未逐条列出。',
  noSources: '本会话还没有 Zotero 文献。',
  searchFrom: '搜索 "{query}"',
  searchFromBrowse: '浏览检索',
  provenanceMismatch: '属于另一个 Zotero 数据库',
  evidenceBadge: '片段 {count}',
  exportBadge: '导出 {count}',
  failedBadge: '失败 {count}',
  runningBadge: '进行中 {count}',
  stoppedBadge: '已停止 {count}',
  badgePdf: 'PDF',
  issuesBadge: '异常',
  bestAttachmentLabel: '最佳附件',
  localFile: '本地文件',
  linkedUrl: '链接地址',
  copyRef: '复制 ref',
  copyExport: '复制',
  copyCite: '\\cite{…}',
  copyAll: '复制全部',
  downloadAll: '下载全部',
  unresolvedItemsNote: '另有 {count} 篇无法单独显示',
  downloadFull: '下载完整',
  askAboutItem: '问这篇',
  askTemplate: '关于这篇文献（{ref}）：',
  citeTemplate: '把这篇文献从 Zotero 导出为 BibTeX：{ref}',
  exportCitation: '导出引用',
  sourceAnnotation: '批注',
  sourceNote: '笔记',
  sourceAbstract: '摘要',
  sourceFulltext: '全文',
  pageLabel: '第{label}页',
  truncatedPreview: '(截断)',
  retrievedMultiple: '经 {count} 次检索取得',
  coverageLabel: '索引覆盖',
  coveragePages: '{indexed}/{total} 页',
  coverageChars: '{indexed}/{total} 字符',
  coverageComplete: ' · 已完整',
  coverageIncomplete: ' · 未完整',
  budgetLimitedNote: '结果受全局预算限制。',
  availReturned: '返回 {count} 条匹配',
  availUnavailable: '该来源不可用',
  availNoMatch: '没有返回匹配',
  evidenceRetrievedNone: '这次没有找到相关片段。',
  evidenceNotRetrieved: '还没有查过这篇文献的内容。向 Agent 提问这篇文献后，相关段落会显示在这里。',
  evidenceReportedNoPreview: '各次检索共报告 {count} 条相关片段，未保留预览。',
  evidenceEmptyNote:
    '还没有相关片段。向 Agent 提问某篇文献的内容后，找到的摘要、批注、笔记或全文段落会出现在这里。',
  exportsEmptyNote: '本会话还没有成功导出。',
  exportsIncompleteNote: '未完成的导出操作：{counts}',
  formatCitation: '引文',
  formatBibliography: '参考文献表',
  formatUnknown: '导出',
  exportRefCount: '{count} 条文献',
  exportRefsOmitted: '另有 {count} 条未列出',
  openInZotero: '在 Zotero 中打开',
  openPdf: '打开 PDF',
  openAnnotation: '打开批注',
  instanceUnverified: '无法验证当前 Zotero 实例',
  openUnverifiedNote: '（{detail}）',
  availabilityEntry: '{source}：{detail}',
  starterFind: '找文献…',
  starterFindTemplate: '帮我在 Zotero 文献库里检索这个主题的文献：',
  starterCompare: '比较选中的文献…',
  starterCompareTemplate: '比较下面几篇 Zotero 文献：',
  starterEvidence: '查找相关片段…',
  starterEvidenceTemplate: '在这篇文献中查找相关片段，问题是：',
  starterExportSelected: '导出选中条目的引用…',
  starterExportSelectedTemplate: '把下面几篇从我的 Zotero 库导出为引用：',
}
