/**
 * Locale bundles for the Zotero plugin: the Settings page (fixed chrome,
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
  | 'save'
  | 'saving'
  | 'saveFailed'
  | 'unavailable'
  | 'invalidNumber'
  | GroupKey
  | FieldKey
  | `${FieldKey}Hint`
  | 'copy'
  | 'copied'
  | 'commandInputAria'
  | 'checking'
  | 'statusUnavailable'
  | 'statusConnectedNote'
  | 'detailsLabel'
  | 'apiVersionLabel'
  | 'schemaVersionLabel'
  | 'zoteroVersionLabel'
  | 'serverIdLabel'
  | 'writeLabel'
  | 'writeAuthorizedLabel'
  | 'writeUnauthorizedLabel'
  | 'writeDisabledLabel'
  | 'writeRiskTitle'
  | 'writeRiskDescription'
  | 'writeRiskAcknowledge'
  | 'writeRiskConfirm'
  | 'writeRiskCancel'
  | 'writeRiskClose'
  | 'buildInfoLabel'
  | 'diagnosisLabel'
  | 'diagnosisNotRunning'
  | 'diagnosisApiDisabled'
  | 'diagnosisApiVersion'
  | 'diagnosisTimeout'
  | 'diagnosisNotComposed'
  | 'diagnosisProviderUnavailable'
  | 'diagnosisCapabilityUnavailable'
  | 'diagnosisUnknown'
  | 'refresh'
  | 'lastCheckedLabel'
  | 'quickConfigTitle'
  | 'quickConfigHint'
  | 'detailSectionTitle'
  | 'tipsLabel'
  | 'tipNoKey'
  | 'tipFulltext'
  | 'tipSettingsNav'
  | 'lensSources'
  | 'lensExports'
  | 'lensBarLabel'
  | 'filterBarLabel'
  | 'inspectorTabsLabel'
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
  | 'overviewScopePublications'
  | 'overviewScopeCollection'
  | 'overviewScopeSavedSearch'
  | 'searchDetailOpen'
  | 'searchDetailClose'
  | 'refLine'
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
  description: 'Connect to your local Zotero library for search, passages, and citations.',
  overridden: 'Overridden',
  reset: 'Reset to default',
  readOnly: 'This deployment stores settings read-only.',
  discard: 'Discard changes',
  unsaved: 'Unsaved',
  save: 'Save',
  saving: 'Saving…',
  saveFailed: 'The deployment did not accept these values; they were left for you to correct.',
  unavailable:
    'This deployment does not serve the Zotero settings namespace, so there is nothing to configure here.',
  invalidNumber: 'Enter a number, or leave blank to use the default.',
  groupConnection: 'Connection',
  groupSearch: 'Search limits',
  groupOutput: 'Output limits',
  groupDefaults: 'Citation defaults',
  groupWrite: 'Writing',
  writeEnabled: 'Allow writes',
  writeEnabledHint: 'The agent can create notes, add tags, and put items into collections.',
  writeRiskTitle: 'Enable writes?',
  writeRiskDescription:
    'Turning this on lets the agent change your Zotero library — create notes, add tags, and move items into collections. AI can make mistakes; review before enabling.',
  writeRiskAcknowledge:
    'I understand this will modify my Zotero library and that AI can make mistakes.',
  writeRiskConfirm: 'Allow writes',
  writeRiskCancel: 'Cancel',
  writeRiskClose: 'Close',
  writePersistKey: 'Remember the Zotero write key',
  writePersistKeyHint:
    'Stores an "Always Allow" key from the Zotero dialog so writes stop asking every time. One-time approvals are never stored.',
  baseUrl: 'Zotero local API address',
  baseUrlHint: 'Loopback HTTP only (127.0.0.1, localhost, or ::1).',
  provider: 'Provider id',
  providerHint: 'Which registered provider serves requests; the built-in one is local.',
  timeoutMs: 'Request timeout (ms)',
  timeoutMsHint: 'How long one request may run before it is given up.',
  maxSearchResults: 'Search result cap',
  maxSearchResultsHint: 'Most items one search returns.',
  maxNoteScanRecords: 'Note scan cap',
  maxNoteScanRecordsHint: 'Most notes a search scans for body matches.',
  maxEvidenceChars: 'Passage character budget',
  maxEvidenceCharsHint: 'Total characters kept across retrieved passages.',
  maxEvidencePassages: 'Passage cap',
  maxEvidencePassagesHint: 'Most passages one retrieval returns.',
  maxDetailChars: 'Abstract preview budget',
  maxDetailCharsHint: 'Characters shown in the abstract preview of an item.',
  maxNoteBodyChars: 'Note body budget',
  maxNoteBodyCharsHint: 'Characters kept from a note’s own body.',
  maxNoteChars: 'Note preview budget',
  maxNoteCharsHint: 'Characters kept per note preview.',
  maxNoteRecords: 'Note record cap',
  maxNoteRecordsHint: 'Most notes returned for one item.',
  maxAnnotationRecords: 'Annotation record cap',
  maxAnnotationRecordsHint: 'Most annotations returned for one item.',
  fulltextChunkWords: 'Full-text chunk words',
  fulltextChunkWordsHint: 'Word count of each full-text chunk entering passage ranking.',
  maxFulltextChars: 'Full-text character bound',
  maxFulltextCharsHint: 'Most full-text characters considered when ranking passages.',
  maxResponseBytes: 'Response byte cap',
  maxResponseBytesHint: 'Hard byte limit for one API response body.',
  maxExportChars: 'Export character cap',
  maxExportCharsHint: 'Most characters one export may produce.',
  maxExportRefs: 'Export ref cap',
  maxExportRefsHint: 'Most references one export accepts.',
  maxBrowseResults: 'Browse result cap',
  maxBrowseResultsHint: 'Most items one browse call returns.',
  maxChangesResults: 'Changes listing cap',
  maxChangesResultsHint:
    'Most rows one changes listing shows per kind — display only; the diff still covers the whole range and totals report the true counts.',
  defaultStyle: 'Default citation style',
  defaultStyleHint: 'CSL style id used for citations and bibliographies (e.g. apa).',
  defaultLocale: 'Default citation locale',
  defaultLocaleHint: 'CSL locale used for citations and bibliographies (e.g. en-US).',
  groupWeb: 'Literature tab',
  webEnabled: 'Show literature tab',
  webEnabledHint:
    'Shows a Zotero literature tab at the top of conversations, with literature, passages, and exports.',
  copy: 'Copy',
  copied: 'Copied',
  commandInputAria: 'Command input',
  checking: 'Checking…',
  statusUnavailable: 'Unavailable',
  statusConnectedNote: 'Connected to Zotero',
  detailsLabel: 'Diagnostics',
  apiVersionLabel: 'API version',
  schemaVersionLabel: 'Schema version',
  zoteroVersionLabel: 'Zotero version',
  serverIdLabel: 'Server ID',
  writeLabel: 'Write',
  writeAuthorizedLabel: 'enabled, key stored',
  writeUnauthorizedLabel: 'enabled, no key yet',
  writeDisabledLabel: 'disabled',
  buildInfoLabel: 'Build',
  diagnosisLabel: 'Diagnosis',
  diagnosisNotRunning:
    'Zotero is not running or unreachable. Please launch Zotero and enable "Allow other applications on this computer to communicate with Zotero" in Settings → Advanced, then click Refresh.',
  diagnosisApiDisabled:
    'Zotero local API is disabled. In Zotero Settings → Advanced, check "Allow other applications on this computer to communicate with Zotero", then click Refresh.',
  diagnosisApiVersion: 'Incompatible Zotero API version. This plugin requires Zotero 7 or later.',
  diagnosisTimeout:
    'Connection to local Zotero timed out. Please check if Zotero is responsive or if the port is busy.',
  diagnosisNotComposed:
    'The Zotero plugin service is not loaded in this session. Open Plugins and enable dsh-zotero, then refresh.',
  diagnosisProviderUnavailable:
    'The configured Zotero provider is not registered. Check the provider id in Settings → Zotero.',
  diagnosisCapabilityUnavailable:
    'The selected Zotero provider does not serve this capability. Switch provider or enable the feature.',
  diagnosisUnknown: 'Connection error',
  refresh: 'Refresh',
  lastCheckedLabel: 'Last checked',
  quickConfigTitle: 'Quick settings',
  quickConfigHint: 'Toggle the core Zotero features here. Full settings live in Settings → Zotero.',
  detailSectionTitle: 'Service status & quick start',
  tipsLabel: 'Quick tips',
  tipNoKey: 'No API key needed: it talks to the Zotero app on this computer.',
  tipFulltext: 'Full-text search: index PDFs in Zotero so the agent can quote real passages.',
  tipSettingsNav: 'Fine-tune connection, limits, and citation style in Settings → Zotero.',
  lensSources: 'Literature',
  lensExports: 'Exports',
  lensBarLabel: 'Literature views',
  filterBarLabel: 'Source filters',
  inspectorTabsLabel: 'Source detail panels',
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
  overviewScopePublications: 'My Publications',
  overviewScopeCollection: 'Collection',
  overviewScopeSavedSearch: 'Saved search',
  searchDetailOpen: 'Search details',
  searchDetailClose: 'Hide search details',
  refLine: 'Ref',
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
  description: '连接本机 Zotero，检索文献、提取相关片段并导出引用。',
  overridden: '已覆盖',
  reset: '恢复默认',
  readOnly: '本部署的设置为只读。',
  discard: '放弃修改',
  unsaved: '未保存',
  save: '保存',
  saving: '保存中…',
  saveFailed: '本部署没有接受这些值，已保留供你修改。',
  unavailable: '本部署没有提供 Zotero 设置项，这里暂无可配置内容。',
  invalidNumber: '请填数字；留空表示使用默认值。',
  groupConnection: '连接',
  groupSearch: '检索限制',
  groupOutput: '输出限制',
  groupDefaults: '引文默认值',
  groupWrite: '写入',
  writeEnabled: '允许写入',
  writeEnabledHint: '可创建笔记、添加标签、加入合集。',
  writeRiskTitle: '开启写入？',
  writeRiskDescription:
    '开启后智能体可以修改你的 Zotero 文献库：创建笔记、添加标签、把条目加入合集。AI 可能会出错，请确认后再开启。',
  writeRiskAcknowledge: '我了解这会修改我的 Zotero 文献库，且 AI 可能出错',
  writeRiskConfirm: '允许写入',
  writeRiskCancel: '取消',
  writeRiskClose: '关闭',
  writePersistKey: '记住 Zotero 写入授权',
  writePersistKeyHint:
    '保存 Zotero 弹窗里「始终允许」的授权密钥，之后写入不再反复弹窗。一次性授权不会保存。',
  baseUrl: 'Zotero 本地接口地址',
  baseUrlHint: '仅限本机地址（127.0.0.1、localhost 或 ::1）。',
  provider: '提供方 ID',
  providerHint: '处理请求的已注册提供方；内置提供方为 local。',
  timeoutMs: '请求超时（毫秒）',
  timeoutMsHint: '单次请求最长等待多久后放弃。',
  maxSearchResults: '搜索结果上限',
  maxSearchResultsHint: '单次搜索最多返回的条目数。',
  maxNoteScanRecords: '笔记扫描上限',
  maxNoteScanRecordsHint: '搜索正文时最多扫描的笔记条数。',
  maxEvidenceChars: '相关片段总字数',
  maxEvidenceCharsHint: '单次取文保留的相关片段合计字数。',
  maxEvidencePassages: '相关片段条数',
  maxEvidencePassagesHint: '单次取文最多返回的相关片段数。',
  maxDetailChars: '摘要预览字数',
  maxDetailCharsHint: '条目详情里摘要预览的字数上限。',
  maxNoteBodyChars: '笔记正文字数',
  maxNoteBodyCharsHint: '单条笔记正文最多保留的字数。',
  maxNoteChars: '笔记预览字数',
  maxNoteCharsHint: '每条笔记预览的字数上限。',
  maxNoteRecords: '笔记条数上限',
  maxNoteRecordsHint: '单个条目最多返回的笔记条数。',
  maxAnnotationRecords: '批注条数上限',
  maxAnnotationRecordsHint: '单个条目最多返回的批注条数。',
  fulltextChunkWords: '全文分块词数',
  fulltextChunkWordsHint: '全文按词数分块后参与相关片段排序。',
  maxFulltextChars: '全文字符上限',
  maxFulltextCharsHint: '参与相关片段排序的全文最多字数。',
  maxResponseBytes: '单次响应字节上限',
  maxResponseBytesHint: '每次接口响应体的字节上限。',
  maxExportChars: '导出字数上限',
  maxExportCharsHint: '单次导出内容的字数上限。',
  maxExportRefs: '导出条数上限',
  maxExportRefsHint: '单次导出最多包含的文献条数。',
  maxBrowseResults: '浏览结果上限',
  maxBrowseResultsHint: '单次浏览最多返回的条目数。',
  maxChangesResults: '变更列表条数上限',
  maxChangesResultsHint:
    '变更列表每次最多列出的条数（仅影响显示）：差异仍会整段计算，统计给出真实数量。',
  defaultStyle: '默认引文样式',
  defaultStyleHint: '引文与参考文献使用的 CSL 样式 id（如 apa）。',
  defaultLocale: '默认引文语言',
  defaultLocaleHint: '引文与参考文献使用的区域设置（如 en-US）。',
  groupWeb: '文献标签',
  webEnabled: '显示文献标签',
  webEnabledHint: '在会话顶部显示 Zotero 文献标签，包括文献、相关片段和导出。',
  copy: '复制',
  copied: '已复制',
  commandInputAria: '指令输入',
  checking: '检查中…',
  statusUnavailable: '不可用',
  statusConnectedNote: '已连接到 Zotero',
  detailsLabel: '诊断详情',
  apiVersionLabel: 'API 版本',
  schemaVersionLabel: 'Schema 版本',
  zoteroVersionLabel: 'Zotero 版本',
  serverIdLabel: '服务器 ID',
  writeLabel: '写入',
  writeAuthorizedLabel: '已启用，密钥已保存',
  writeUnauthorizedLabel: '已启用，尚未授权',
  writeDisabledLabel: '已关闭',
  buildInfoLabel: '构建',
  diagnosisLabel: '诊断',
  diagnosisNotRunning:
    '未检测到正在运行的 Zotero 客户端。请启动 Zotero，并在 [设置 -> 高级] 中勾选“允许此计算机上的其他应用程序与 Zotero 通信”，然后点击刷新重试。',
  diagnosisApiDisabled:
    'Zotero 本地 API 未启用。请在 Zotero 的 [设置 -> 高级] 中勾选“允许此计算机上的其他应用程序与 Zotero 通信”，然后点击刷新重试。',
  diagnosisApiVersion: '本地 Zotero API 版本不兼容，本插件需要与 Zotero 7 及以上版本配合使用。',
  diagnosisTimeout: '连接本地 Zotero 实例超时，请检查 Zotero 是否正在响应或端口被占用。',
  diagnosisNotComposed: '本会话尚未装载 Zotero 插件服务。请在插件页启用 dsh-zotero 后刷新。',
  diagnosisProviderUnavailable: '配置的 Zotero 提供方未注册。请到 [设置 -> Zotero] 检查提供方 ID。',
  diagnosisCapabilityUnavailable: '当前 Zotero 提供方不支持该能力。请切换提供方或启用对应功能。',
  diagnosisUnknown: '连接异常',
  refresh: '刷新',
  lastCheckedLabel: '上次检查',
  quickConfigTitle: '常用快速设置',
  quickConfigHint: '在此快速开关核心功能。完整配置请前往 [设置 -> Zotero]。',
  detailSectionTitle: '服务状态与使用指南',
  tipsLabel: '使用小贴士',
  tipNoKey: '免配 API Key：直接与本机 Zotero 通信，数据不经过云端。',
  tipFulltext: '全文检索：在 Zotero 中为 PDF 建立索引后，智能体可引用原文片段。',
  tipSettingsNav: '连接、限制与引文格式可在 [设置 -> Zotero] 中调整。',
  lensSources: '文献',
  lensExports: '导出',
  lensBarLabel: '文献视图',
  filterBarLabel: '文献筛选',
  inspectorTabsLabel: '文献详情面板',
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
  overviewScopePublications: '我的出版物',
  overviewScopeCollection: '合集',
  overviewScopeSavedSearch: '保存的检索',
  searchDetailOpen: '查看检索条件',
  searchDetailClose: '收起检索条件',
  refLine: 'ref',
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
  evidenceNotRetrieved: '还没有查过这篇文献的内容。向 Agent 提问这篇文献后，相关片段会显示在这里。',
  evidenceReportedNoPreview: '各次检索共报告 {count} 条相关片段，未保留预览。',
  evidenceEmptyNote:
    '还没有相关片段。向 Agent 提问某篇文献的内容后，找到的摘要、批注、笔记或全文片段会出现在这里。',
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
