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
  | 'activationTitle'
  | 'activationClose'
  | 'activationDescription'
  | 'activationStep1'
  | 'activationStep2'
  | 'activationStep2Note'
  | 'activationStatusLabel'
  | 'activationReady'
  | 'activationReadyVersion'
  | 'activationLater'
  | 'activationDetails'
  | 'activationDone'
  | 'activationCheckAgain'
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
  | 'matchedInText'
  | 'matchedInComment'
  | 'truncatedPreview'
  | 'retrievedMultiple'
  | 'coverageLabel'
  | 'coveragePages'
  | 'coverageChars'
  | 'coverageComplete'
  | 'coverageIncomplete'
  | 'countOfReturned'
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
  | 'toolTitleSearch'
  | 'toolTitleRetrieve'
  | 'toolTitleExport'
  | 'toolTitleGet'
  | 'toolTitleChildren'
  | 'toolTitleAttachment'
  | 'toolTitleCreateNote'
  | 'toolTitleAddTags'
  | 'toolTitleAddToCollection'
  | 'toolTitleBrowse'
  | 'toolTitleChanges'
  | 'toolRunning'
  | 'toolFailed'
  | 'toolStopped'
  | 'toolDeclined'
  | 'toolUnverified'
  | 'toolUnverifiedDetail'
  | 'toolSummaryJobPending'
  | 'toolOmittedPassages'
  | 'toolInspect'
  | 'toolSearchRunning'
  | 'toolRetrieveRunning'
  | 'toolExportRunning'
  | 'toolSummaryFound'
  | 'toolSummaryFoundWithNotes'
  | 'toolSummaryEvidence'
  | 'toolSummaryExport'
  | 'toolSummaryItem'
  | 'toolSummaryChildren'
  | 'toolSummaryAttachment'
  | 'toolSummaryCreateNote'
  | 'toolSummaryAddTags'
  | 'toolSummaryAddTagsRequested'
  | 'toolNoTagsAdded'
  | 'toolSummaryAddToCollection'
  | 'toolSummaryAddToCollectionNoop'
  | 'toolSummaryAddToCollectionRequested'
  | 'toolSummaryBrowseKind'
  | 'toolSummaryBrowsePage'
  | 'toolBrowseNextPage'
  | 'toolSummaryChanges'
  | 'toolChangesItems'
  | 'toolChangesChildItems'
  | 'toolChangesTrashedItems'
  | 'toolChangesCollections'
  | 'toolChangesSavedSearches'
  | 'toolChangesFulltext'
  | 'toolChangesCursor'
  | 'toolChangesCursorValue'
  | 'toolChangesRange'
  | 'toolChangesRangeUnknown'
  | 'toolChangesNoCursor'
  | 'toolChangesWithheld'
  | 'toolChangesFulltextCaveat'
  | 'withheldNotServed'
  | 'withheldRangeNotCovered'
  | 'withheldUnreadable'
  | 'withheldRemedyPermanent'
  | 'withheldRemedyRebaseline'
  | 'withheldRemedyRerun'
  | 'toolDeletedTitle'
  | 'toolDeletedNone'
  | 'toolDeletedItems'
  | 'toolDeletedCollections'
  | 'toolDeletedSavedSearches'
  | 'toolDeletedTags'
  | 'toolDeletedOther'
  | 'toolSummaryJobBackground'
  | 'toolSummaryJobPromoted'
  | 'toolParentItem'
  | 'toolTags'
  | 'toolChildrenNotes'
  | 'toolChildrenAnnotations'
  | 'toolChildrenAttachments'
  | 'toolChildrenNone'
  | 'toolNoResults'
  | 'toolDefaultNoteTitle'
  | 'badgeSuccess'
  | 'badgeNoOp'
  | 'badgeUnreported'
  | 'commandChecking'
  | 'commandFailed'
  | 'statusServerIdUnreported'
  | 'statusLocalApiAddress'

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
  writeNoteMaxChars: 'Note body cap',
  writeNoteMaxCharsHint: 'Most characters one research note body may carry.',
  writeListMaxItems: 'Write list cap',
  writeListMaxItemsHint: 'Most items one write call may carry in a list argument.',
  writeAuthorizeDeadlineMs: 'Authorize dialog deadline (ms)',
  writeAuthorizeDeadlineMsHint:
    'How long the Zotero authorization dialog may stay open during a write.',
  baseUrl: 'Zotero local API address',
  baseUrlHint: 'Loopback HTTP only (127.0.0.1, localhost, or ::1).',
  provider: 'Provider id',
  providerHint: 'Which registered provider serves requests; the built-in one is local.',
  timeoutMs: 'Request timeout (ms)',
  timeoutMsHint: 'How long one request may run before it is given up.',
  maxInFlightRequests: 'Concurrent request cap',
  maxInFlightRequestsHint: 'Most requests the plugin keeps in flight against the Local API.',
  maxSearchResults: 'Search result cap',
  maxSearchResultsHint: 'Most items one search returns.',
  maxNoteScanRecords: 'Note scan cap',
  maxNoteScanRecordsHint: 'Most notes a search scans for body matches.',
  searchConcurrency: 'Search concurrency',
  searchConcurrencyHint: 'Parallel parent-attribution queries one search keeps in flight.',
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
  retrieveAttachmentCap: 'Attachment cap per retrieval',
  retrieveAttachmentCapHint: 'Most attachments one retrieval ranks full text from.',
  graphConcurrency: 'Retrieve concurrency',
  graphConcurrencyHint: 'Parallel attachment reads one retrieval keeps in flight.',
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
  scopeListingTtlMs: 'Scope listing cache (ms)',
  scopeListingTtlMsHint: 'How long a collections/searches listing is trusted before a re-read.',
  defaultStyle: 'Default citation style',
  defaultStyleHint: 'CSL style id used for citations and bibliographies (e.g. apa).',
  defaultLocale: 'Default citation locale',
  defaultLocaleHint: 'CSL locale used for citations and bibliographies (e.g. en-US).',
  groupJobs: 'Background tasks',
  enableRunInBackground: 'Allow background tasks',
  enableRunInBackgroundHint:
    'Allow tools like export and changes to be started in the background via run_in_background. Slow-task promotion is controlled separately.',
  promoteOnTimeout: 'Promote slow tasks to background',
  promoteOnTimeoutHint:
    'Automatically promote long-running operations to background jobs when foreground wait expires.',
  foregroundWaitMs: 'Foreground wait timeout (ms)',
  foregroundWaitMsHint:
    'How long to wait synchronously before promoting an operation to a background job.',
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
  activationTitle: 'Enable Zotero Plugin',
  activationClose: 'Close guidance',
  activationDescription:
    'Before letting agents search and cite your library, please make sure your local environment is ready:',
  activationStep1: 'Ensure local Zotero app (v7+) is running.',
  activationStep2:
    'In Zotero Settings → Advanced, check "Allow other applications on this computer to communicate with Zotero".',
  activationStep2Note:
    'Leaving this unchecked causes HTTP 403 Forbidden errors when connecting to the local API.',
  activationStatusLabel: 'Connection status',
  activationReady: 'Connected to local Zotero. Ready to use!',
  activationReadyVersion: 'Connected to local Zotero ({version}). Ready to use!',
  activationLater: 'Later',
  activationDetails: 'Open Details',
  activationDone: 'Done',
  activationCheckAgain: 'Check Again',
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
  matchedInText: 'match in text',
  matchedInComment: 'match in comment',
  truncatedPreview: '(truncated)',
  retrievedMultiple: 'gathered across {count} retrieves',
  coverageLabel: 'Indexing coverage',
  coveragePages: '{indexed}/{total} pages',
  coverageChars: '{indexed}/{total} chars',
  coverageComplete: ' · complete',
  coverageIncomplete: ' · incomplete',
  countOfReturned: '{total} in total, {shown} shown',
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
  toolTitleSearch: 'Zotero Search',
  toolTitleRetrieve: 'Zotero Retrieve Evidence',
  toolTitleExport: 'Zotero Export Citation',
  toolTitleGet: 'Zotero Item Details',
  toolTitleChildren: 'Zotero Item Children',
  toolTitleAttachment: 'Zotero Attachment',
  toolTitleCreateNote: 'Zotero Create Note',
  toolTitleAddTags: 'Zotero Add Tags',
  toolTitleAddToCollection: 'Zotero Add to Collection',
  toolTitleBrowse: 'Zotero Browse',
  toolTitleChanges: 'Zotero Sync Changes',
  toolRunning: 'Running…',
  toolFailed: 'Failed',
  toolStopped: 'Stopped',
  toolDeclined: 'Write plan was declined; not executed',
  toolUnverified: 'Committed, not verified; do not retry',
  toolUnverifiedDetail: 'What Zotero reported',
  toolSummaryJobPending: 'Still running; nothing to read yet.',
  toolOmittedPassages: '{count} further passages are not listed here.',
  toolInspect: 'Inspect',
  toolSearchRunning: 'Searching Zotero library…',
  toolRetrieveRunning: 'Retrieving evidence passages…',
  toolExportRunning: 'Exporting citations…',
  toolSummaryFound: 'found {count} items',
  toolSummaryFoundWithNotes: 'found {count} items (+{notes} notes)',
  toolSummaryEvidence: 'extracted {count} passages',
  toolSummaryExport: 'exported {format} ({count} items)',
  toolSummaryItem: '{title} ({year})',
  toolSummaryChildren: '{count} child objects',
  toolSummaryAttachment: 'Attachment: {title}',
  toolSummaryCreateNote: 'Created note "{title}"',
  toolSummaryAddTags: 'Added {count} tags',
  toolSummaryAddTagsRequested: 'Requested {count} tags',
  toolNoTagsAdded: 'Every requested tag was already present; nothing was written',
  toolSummaryAddToCollection: 'Added to collection "{name}"',
  toolSummaryAddToCollectionNoop: 'Already in collection "{name}"; nothing was written',
  toolSummaryAddToCollectionRequested: 'Requested membership in collection "{name}"',
  toolSummaryBrowseKind: 'Browsing {kind}',
  toolSummaryBrowsePage: 'Browsing {kind}: {returned} of {total}',
  toolBrowseNextPage: 'More results start at offset {offset}',
  toolSummaryChanges: 'Sync changes: {count} records',
  toolChangesItems: 'Items',
  toolChangesChildItems: 'Child objects',
  toolChangesTrashedItems: 'Items in the trash',
  toolChangesCollections: 'Collections',
  toolChangesSavedSearches: 'Saved searches',
  toolChangesFulltext: 'Full-text reindexed',
  toolChangesCursor: 'Cursor',
  toolChangesCursorValue: 'version {version} on instance {serverId}',
  toolChangesRange: 'Range: version {from} → {to}',
  toolChangesRangeUnknown: 'an unverified end',
  toolChangesNoCursor:
    'This read withheld a cursor, so it is not a settled range and not safe to resume from.',
  toolChangesWithheld: 'Not covered by this read',
  toolChangesFulltextCaveat: 'Index versions count on their own, so these rows are a listing.',
  withheldNotServed: 'not served by this Zotero build',
  withheldRangeNotCovered: 'older than the change history this build keeps',
  withheldUnreadable: 'the answer was unreadable',
  withheldRemedyPermanent: 'nothing to do; this build never reports it',
  withheldRemedyRebaseline: 'take a fresh baseline to track it from here',
  withheldRemedyRerun: 'run the call again',
  toolDeletedTitle: 'Deletions: {count}',
  toolDeletedNone: 'Deletions: none in this range.',
  toolDeletedItems: 'Deleted items',
  toolDeletedCollections: 'Deleted collections',
  toolDeletedSavedSearches: 'Deleted saved searches',
  toolDeletedTags: 'Deleted tags',
  toolDeletedOther: 'Other deleted objects',
  toolSummaryJobBackground: 'background job {jobId}',
  toolSummaryJobPromoted: 'promoted to job {jobId}',
  toolParentItem: 'Parent Item',
  toolTags: 'Tags',
  toolChildrenNotes: 'Notes',
  toolChildrenAnnotations: 'Annotations',
  toolChildrenAttachments: 'Attachments',
  toolChildrenNone: 'None of this kind.',
  toolNoResults: 'No matching results found',
  toolDefaultNoteTitle: 'Note',
  badgeSuccess: 'OK',
  badgeNoOp: 'No change',
  badgeUnreported: 'Outcome unreported',
  commandChecking: 'Connecting to local API…',
  commandFailed: 'Command failed',
  statusServerIdUnreported: 'Not reported (this build does not identify database)',
  statusLocalApiAddress: 'Local API Address',
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
  writeNoteMaxChars: '笔记正文字数上限',
  writeNoteMaxCharsHint: '单条研究笔记正文最多容纳的字符数。',
  writeListMaxItems: '写入列表上限',
  writeListMaxItemsHint: '单次写入调用的列表参数最多容纳的条数。',
  writeAuthorizeDeadlineMs: '授权弹窗时限（毫秒）',
  writeAuthorizeDeadlineMsHint: '写入时等待 Zotero 授权弹窗的最长时间。',
  baseUrl: 'Zotero 本地接口地址',
  baseUrlHint: '仅限本机地址（127.0.0.1、localhost 或 ::1）。',
  provider: '提供方 ID',
  providerHint: '处理请求的已注册提供方；内置提供方为 local。',
  timeoutMs: '请求超时（毫秒）',
  timeoutMsHint: '单次请求最长等待多久后放弃。',
  maxInFlightRequests: '并发请求数上限',
  maxInFlightRequestsHint: '插件同时对本地接口保持的最多在途请求数。',
  maxSearchResults: '搜索结果上限',
  maxSearchResultsHint: '单次搜索最多返回的条目数。',
  maxNoteScanRecords: '笔记扫描上限',
  maxNoteScanRecordsHint: '搜索正文时最多扫描的笔记条数。',
  searchConcurrency: '搜索并发数',
  searchConcurrencyHint: '单次搜索可同时发起的归属查询数。',
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
  retrieveAttachmentCap: '单次取文附件上限',
  retrieveAttachmentCapHint: '单次取文最多参与全文排序的附件数。',
  graphConcurrency: '取文并发数',
  graphConcurrencyHint: '单次取文同时读取附件的并发数。',
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
  scopeListingTtlMs: '范围列表缓存（毫秒）',
  scopeListingTtlMsHint: '集合与检索列表在重新拉取前的缓存时长。',
  defaultStyle: '默认引文样式',
  defaultStyleHint: '引文与参考文献使用的 CSL 样式 id（如 apa）。',
  defaultLocale: '默认引文语言',
  defaultLocaleHint: '引文与参考文献使用的区域设置（如 en-US）。',
  groupJobs: '后台任务',
  enableRunInBackground: '允许后台任务',
  enableRunInBackgroundHint:
    '允许文献导出、变更扫描等工具通过 run_in_background 显式放入后台；超时自动提升由另一项单独控制。',
  promoteOnTimeout: '超时自动转为后台任务',
  promoteOnTimeoutHint: '当同步等待超时时，自动将耗时操作转为后台任务继续执行。',
  foregroundWaitMs: '前台等待超时 (毫秒)',
  foregroundWaitMsHint: '同步等待耗时操作完成的最大毫秒数，超出后转入后台任务。',
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
  activationTitle: '启用 Zotero 插件',
  activationClose: '关闭新手引导',
  activationDescription: '在让智能体检索和引用本地文献库前，请确保完成以下准备工作：',
  activationStep1: '确保本地 Zotero 客户端 (v7+) 处于运行状态。',
  activationStep2:
    '在 Zotero 的 [设置 -> 高级] 中勾选“允许此计算机上的其他应用程序与 Zotero 通信”。',
  activationStep2Note: '若未勾选此项，本地 API 请求将直接返回 403 权限受阻错误。',
  activationStatusLabel: '连通性自检',
  activationReady: '已连接到本地 Zotero，服务就绪！',
  activationReadyVersion: '已连接到本地 Zotero ({version})，服务就绪！',
  activationLater: '稍后设置',
  activationDetails: '前往配置详情',
  activationDone: '完成',
  activationCheckAgain: '重新检测',
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
  matchedInText: '命中原文',
  matchedInComment: '命中批注',
  truncatedPreview: '(截断)',
  retrievedMultiple: '经 {count} 次检索取得',
  coverageLabel: '索引覆盖',
  coveragePages: '{indexed}/{total} 页',
  coverageChars: '{indexed}/{total} 字符',
  coverageComplete: ' · 已完整',
  coverageIncomplete: ' · 未完整',
  countOfReturned: '共 {total} 条，列出 {shown} 条',
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
  toolTitleSearch: 'Zotero 检索文献',
  toolTitleRetrieve: 'Zotero 提取证据',
  toolTitleExport: 'Zotero 导出引文',
  toolTitleGet: 'Zotero 文献详情',
  toolTitleChildren: 'Zotero 子项与附件',
  toolTitleAttachment: 'Zotero 附件',
  toolTitleCreateNote: 'Zotero 创建笔记',
  toolTitleAddTags: 'Zotero 添加标签',
  toolTitleAddToCollection: 'Zotero 添加到合集',
  toolTitleBrowse: 'Zotero 浏览分类',
  toolTitleChanges: 'Zotero 同步记录',
  toolRunning: '执行中…',
  toolFailed: '执行失败',
  toolStopped: '已中断',
  toolDeclined: '写操作未获批准，已取消执行',
  toolUnverified: '已提交但未核验，请勿重试',
  toolUnverifiedDetail: 'Zotero 的原始返回',
  toolSummaryJobPending: '仍在运行中，暂时没有可读的结果。',
  toolOmittedPassages: '另有 {count} 条证据片段未在此列出。',
  toolInspect: '检查调用',
  toolSearchRunning: '正在检索 Zotero 文献库…',
  toolRetrieveRunning: '正在提取文献证据…',
  toolExportRunning: '正在导出引文…',
  toolSummaryFound: '找到 {count} 篇文献',
  toolSummaryFoundWithNotes: '找到 {count} 篇文献 (+{notes} 条笔记)',
  toolSummaryEvidence: '提取 {count} 条证据片段',
  toolSummaryExport: '导出 {format} ({count} 篇)',
  toolSummaryItem: '{title} ({year})',
  toolSummaryChildren: '{count} 个子对象',
  toolSummaryAttachment: '附件: {title}',
  toolSummaryCreateNote: '已创建笔记 "{title}"',
  toolSummaryAddTags: '已添加 {count} 个标签',
  toolSummaryAddTagsRequested: '请求添加 {count} 个标签',
  toolNoTagsAdded: '请求的标签均已存在，未写入任何内容',
  toolSummaryAddToCollection: '已加入合集 "{name}"',
  toolSummaryAddToCollectionNoop: '已在合集 "{name}" 中，未写入任何内容',
  toolSummaryAddToCollectionRequested: '请求加入合集 "{name}"',
  toolSummaryBrowseKind: '正在浏览 {kind}',
  toolSummaryBrowsePage: '浏览 {kind}：{returned} / {total}',
  toolBrowseNextPage: '更多结果从 offset {offset} 开始',
  toolSummaryChanges: '同步变更: {count} 条',
  toolChangesItems: '条目',
  toolChangesChildItems: '子对象',
  toolChangesTrashedItems: '回收站中的条目',
  toolChangesCollections: '合集',
  toolChangesSavedSearches: '保存的检索',
  toolChangesFulltext: '重新索引的全文',
  toolChangesCursor: '游标',
  toolChangesCursorValue: '版本 {version}，实例 {serverId}',
  toolChangesRange: '区间：版本 {from} → {to}',
  toolChangesRangeUnknown: '未核验的终点',
  toolChangesNoCursor: '本次读取没有给出游标，因此区间并未落定，也不能作为续读起点。',
  toolChangesWithheld: '本次读取未覆盖的对象',
  toolChangesFulltextCaveat: '索引版本使用独立计数器，因此这些行只是一份清单。',
  withheldNotServed: '当前 Zotero 构建未提供',
  withheldRangeNotCovered: '早于该构建保留的变更历史',
  withheldUnreadable: '返回内容无法读取',
  withheldRemedyPermanent: '无需处理，该构建本就不报告这一项',
  withheldRemedyRebaseline: '重新取一个基线，才能从此刻开始跟踪',
  withheldRemedyRerun: '重新执行这次调用',
  toolDeletedTitle: '删除: {count}',
  toolDeletedNone: '删除: 此区间内没有删除。',
  toolDeletedItems: '已删除的条目',
  toolDeletedCollections: '已删除的合集',
  toolDeletedSavedSearches: '已删除的保存检索',
  toolDeletedTags: '已删除的标签',
  toolDeletedOther: '其他已删除对象',
  toolSummaryJobBackground: '后台任务 {jobId}',
  toolSummaryJobPromoted: '已转为后台任务 {jobId}',
  toolParentItem: '所属父条目',
  toolTags: '标签',
  toolChildrenNotes: '笔记',
  toolChildrenAnnotations: '批注',
  toolChildrenAttachments: '附件',
  toolChildrenNone: '没有这一类子对象',
  toolNoResults: '未检索到匹配结果',
  toolDefaultNoteTitle: '笔记',
  badgeSuccess: '成功',
  badgeNoOp: '无变更',
  badgeUnreported: '结果未报告',
  commandChecking: '正在探测连接…',
  commandFailed: '执行失败',
  statusServerIdUnreported: '未报告（当前构建不支持数据库标识）',
  statusLocalApiAddress: '本地 API 地址',
}
