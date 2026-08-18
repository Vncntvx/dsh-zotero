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
  | 'lensEvidence'
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
  | 'overviewFacts'
  | 'overviewActions'
  | 'overviewNoSearch'
  | 'retrievalRunCount'
  | 'retrievalKeptCount'
  | 'retrievalReportedCount'
  | 'availabilityTitle'
  | 'sidebarSourceCount'
  | 'evidenceEntryLabel'
  | 'backToSources'
  | 'artifactAtLabel'
  | 'downloadArtifact'
  | 'expandFullText'
  | 'collapseFullText'
  | 'filterAll'
  | 'filterPdf'
  | 'filterRetrieved'
  | 'filterEvidence'
  | 'filterExported'
  | 'filterIssues'
  | 'filterClear'
  | 'filterEmptyNote'
  | 'countCandidates'
  | 'countInspected'
  | 'countEvidence'
  | 'countExported'
  | 'sourcesScopeNote'
  | 'omittedRowsNote'
  | 'sourcesEmptyNote'
  | 'noSources'
  | 'fromSearches'
  | 'searchFrom'
  | 'searchFromBrowse'
  | 'evidenceInDetail'
  | 'reportedEvidenceInDetail'
  | 'exportsInDetail'
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
  | 'evidenceReportedNoPreview'
  | 'evidenceScopeNote'
  | 'evidenceEmptyNote'
  | 'exportsEmptyNote'
  | 'exportsIncompleteNote'
  | 'exportsStaticNote'
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
  groupWeb: 'Sources panel',
  webEnabled: 'Zotero Sources tab',
  webEnabledHint:
    'Shows a dedicated Zotero Sources tab at the top of conversations (sources, evidence, exports). Turning it off hides the tab right away.',
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
  lensSources: 'Sources',
  lensEvidence: 'Evidence',
  lensExports: 'Exports',
  panelOverview: 'Overview',
  panelEvidence: 'Evidence',
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
  overviewFacts: 'Session facts',
  overviewActions: 'Actions',
  overviewNoSearch: 'This source was referenced directly, not through a search.',
  retrievalRunCount: '{count} retrieves',
  retrievalKeptCount: '{count} passages kept',
  retrievalReportedCount: '{count} reported',
  availabilityTitle: 'Latest state of each retrieve source',
  sidebarSourceCount: '{count} sources',
  evidenceEntryLabel: 'View all evidence ({count})',
  backToSources: 'Back to sources',
  artifactAtLabel: 'At',
  downloadArtifact: 'Download file',
  expandFullText: 'Show full content',
  collapseFullText: 'Collapse full content',
  filterAll: 'All',
  filterPdf: 'With PDF',
  filterRetrieved: 'Retrieved',
  filterEvidence: 'With evidence',
  filterExported: 'Exported',
  filterIssues: 'Issues',
  filterClear: 'Clear filter',
  filterEmptyNote: 'No sources match this filter.',
  countCandidates: '{count} candidates',
  countInspected: '{count} inspected',
  countEvidence: '{count} with evidence',
  countExported: '{count} exported',
  sourcesScopeNote:
    "A snapshot of this session's Zotero sources — hits from this session's searches and direct references, not a full library browser.",
  omittedRowsNote: '{count} more search results are not listed individually.',
  sourcesEmptyNote: 'No usable sources in this session yet.',
  noSources: 'No Zotero sources in this session yet.',
  fromSearches: "From this session's searches",
  searchFrom: 'Search "{query}"',
  searchFromBrowse: 'Search without a query',
  evidenceInDetail: '{count} evidence passages (see Evidence)',
  reportedEvidenceInDetail: '{count} reported evidence passages across retrieves',
  exportsInDetail: '{count} exports (see Exports)',
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
  copyExport: 'Copy export',
  copyCite: '\\cite{…}',
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
  evidenceRetrievedNone: 'Retrieved, but no passages matched.',
  evidenceReportedNoPreview: 'Reported {count} passages across retrieves; no previews were kept.',
  evidenceScopeNote:
    'Evidence this session gathered, grouped by source; whether the final answer used it is not tracked.',
  evidenceEmptyNote: 'No evidence gathered in this session yet.',
  exportsEmptyNote: 'No successful exports in this session yet.',
  exportsIncompleteNote: 'Exports that did not complete: {counts}',
  exportsStaticNote:
    'Static exports are not inserted or updated in Word, Google Docs, or LibreOffice documents.',
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
  starterEvidence: 'Find evidence in annotations and notes…',
  starterEvidenceTemplate:
    "Find evidence in this paper's annotations and notes for the following question: ",
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
  groupWeb: '来源面板',
  webEnabled: 'Zotero 来源标签页',
  webEnabledHint: '在会话顶部显示 Zotero 来源标签页（来源、证据、导出）；关闭后标签页立即隐藏。',
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
  lensSources: '来源',
  lensEvidence: '证据',
  lensExports: '导出',
  panelOverview: '概览',
  panelEvidence: '证据',
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
  overviewFacts: '会话事实',
  overviewActions: '操作',
  overviewNoSearch: '这篇文献是直接引用的，不是通过检索获得。',
  retrievalRunCount: '检索 {count} 次',
  retrievalKeptCount: '保留 {count} 条',
  retrievalReportedCount: '报告 {count} 条',
  availabilityTitle: '最近一次各检索来源状态',
  sidebarSourceCount: '文献 {count}',
  evidenceEntryLabel: '查看全部证据 {count}',
  backToSources: '返回文献',
  artifactAtLabel: '于',
  downloadArtifact: '下载文件',
  expandFullText: '展开完整内容',
  collapseFullText: '收起完整内容',
  filterAll: '全部',
  filterPdf: '有 PDF',
  filterRetrieved: '已检索',
  filterEvidence: '有证据',
  filterExported: '已导出',
  filterIssues: '异常',
  filterClear: '清除筛选',
  filterEmptyNote: '这个筛选条件下没有文献。',
  countCandidates: '候选 {count}',
  countInspected: '查看详情 {count}',
  countEvidence: '取得证据 {count}',
  countExported: '已导出 {count}',
  sourcesScopeNote: '本会话的 Zotero 来源快照：来自本会话的检索与直接引用，不是完整文献库。',
  omittedRowsNote: '另有 {count} 条检索结果未逐条列出。',
  sourcesEmptyNote: '本会话还没有可展示的文献来源。',
  noSources: '本会话还没有 Zotero 来源。',
  fromSearches: '来自本会话的检索',
  searchFrom: '搜索 "{query}"',
  searchFromBrowse: '浏览检索',
  evidenceInDetail: '证据 {count} 条（见证据页）',
  reportedEvidenceInDetail: '各次检索共报告 {count} 条证据',
  exportsInDetail: '导出 {count} 次（见导出页）',
  provenanceMismatch: '属于另一个 Zotero 数据库',
  evidenceBadge: '证据 {count}',
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
  copyExport: '复制导出内容',
  copyCite: '\\cite{…}',
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
  evidenceRetrievedNone: '已检索，但没有匹配到任何段落。',
  evidenceReportedNoPreview: '各次检索共报告 {count} 条证据，未保留预览段落。',
  evidenceScopeNote: '本会话取得的证据，按文献汇总；不能确定这些内容被用于最终回答。',
  evidenceEmptyNote: '本会话还没有取得证据。',
  exportsEmptyNote: '本会话还没有成功导出。',
  exportsIncompleteNote: '未完成的导出操作：{counts}',
  exportsStaticNote: '静态导出不会插入或更新 Word、Google Docs、LibreOffice 文档。',
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
  starterEvidence: '从批注和笔记中找证据…',
  starterEvidenceTemplate: '在这篇文献的批注和笔记中找证据，问题是：',
  starterExportSelected: '导出选中条目的引用…',
  starterExportSelectedTemplate: '把下面几篇从我的 Zotero 库导出为引用：',
}
