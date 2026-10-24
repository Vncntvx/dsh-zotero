/**
 * The inspector's overview panel: what the user can do with the item first,
 * where it came from second. The action row leads (read PDF in the sidebar,
 * copy title / copy link, ask, export citation, copy ref) as one flat row of
 * visible actions: the copy belongs beside its siblings, not folded into an
 * overflow menu whose single item sat ~190px from its own trigger.
 * Below it the search occurrences show just the query
 * per episode; scope, mode, and filter fields wait behind the "search
 * details" disclosure, together with the raw ref, developer facts that
 * must not compete with the primary actions. Only the PDF read is
 * instance-guarded (a mismatched ref may resolve to the wrong document);
 * the clipboard actions never are.
 * @module dsh-zotero/client/components/workspace/SourceOverview
 */

import { useState } from 'react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { ZoteroAttachmentLocationView } from '../../../contract.ts'
import { askDraftOf, exportDraftOf } from '../../actions/source-actions.ts'
import type { SearchOccurrence, SourceItem } from '../../sources/model.ts'
import { pdfCapabilityOf } from '../../sources/source-capabilities.ts'
import { CopyButton } from '../CopyButton.tsx'
import { BlockedReadAction } from '../open/BlockedReadAction.tsx'
import { PdfReadButton } from '../open/PdfReadButton.tsx'
import { ZoteroLocateActions } from '../open/ZoteroLocateActions.tsx'
import css from './workspace.module.css'

/** The display label of one search mode. */
export function modeLabelOf(mode: 'metadata' | 'everything', t: TranslateNS<'zotero'>): string {
  return mode === 'everything' ? t('modeEverything') : t('modeMetadata')
}

/** The display label of one search scope; unnamed scopes fall back to a short ref. */
export function scopeLabelOf(scope: SearchOccurrence['scope'], t: TranslateNS<'zotero'>): string {
  switch (scope.kind) {
    case 'library':
      return t('overviewScopeLibrary')
    case 'publications':
      return t('overviewScopePublications')
    case 'collection':
      return scope.name ?? scope.ref ?? t('overviewScopeCollection')
    case 'savedSearch':
      return scope.name ?? scope.ref ?? t('overviewScopeSavedSearch')
  }
}

/** The filter line of one episode: item types and tags, or nothing. */
export function filterLineOf(
  itemTypes: readonly string[],
  tags: readonly string[],
  _t: TranslateNS<'zotero'>,
): string {
  const parts = [...itemTypes, ...tags]
  return parts.length === 0 ? '' : parts.join(' · ')
}

interface SourceOverviewProps {
  readonly item: SourceItem
  readonly t: TranslateNS<'zotero'>
  readonly setDraft?: (text: string) => void
  readonly openFile?: (path: string) => void
  readonly resolveAttachment?: (ref: string) => Promise<RemoteResult<ZoteroAttachmentLocationView>>
}

/** The overview panel: guarded actions, search records, and the detail disclosure. */
export function SourceOverview({
  item,
  t,
  setDraft,
  openFile,
  resolveAttachment,
}: SourceOverviewProps) {
  const [detailOpen, setDetailOpen] = useState(false)
  const evidenceMatch = item.evidenceMatch
  const pdfCapability = pdfCapabilityOf(item)

  return (
    <div className={css.panel}>
      <div className={css.actionRow}>
        {pdfCapability !== null &&
          (evidenceMatch === 'mismatch' ? (
            <BlockedReadAction label={t('readPdf')} t={t} className={css.action} />
          ) : (
            <PdfReadButton
              capability={pdfCapability}
              onOpenFile={openFile}
              resolveAttachment={resolveAttachment}
              label={t('readPdf')}
              t={t}
              className={css.action}
            />
          ))}
        <ZoteroLocateActions title={item.title} itemRef={item.ref} t={t} className={css.action} />
        {setDraft !== undefined && (
          <button
            type="button"
            className={css.action}
            onClick={() => {
              setDraft(askDraftOf(item.ref, t))
            }}
          >
            {t('askAboutItem')}
          </button>
        )}
        {setDraft !== undefined && (
          <button
            type="button"
            className={css.action}
            onClick={() => {
              setDraft(exportDraftOf(item.ref, t))
            }}
          >
            {t('exportCitation')}
          </button>
        )}
        <CopyButton
          className={css.action}
          value={item.ref}
          label={t('copyRef')}
          copiedLabel={t('copied')}
        />
      </div>
      {item.evidenceMatch === 'mismatch' && <p className={css.warning}>{t('databaseMismatch')}</p>}
      {item.searches.length > 0 ? (
        item.searches.map((search, index) => (
          <p key={`${search.callId}-${index}`} className={css.line}>
            {search.query !== undefined
              ? t('searchFrom', { query: search.query })
              : t('searchFromBrowse')}
          </p>
        ))
      ) : (
        <p className={css.note}>{t('overviewNoSearch')}</p>
      )}
      <button
        type="button"
        className={css.detailToggle}
        aria-expanded={detailOpen}
        onClick={() => {
          setDetailOpen(!detailOpen)
        }}
      >
        {detailOpen ? t('searchDetailClose') : t('searchDetailOpen')}
      </button>
      {detailOpen && (
        <div className={css.section}>
          {item.searches.map((search, index) => {
            const filters = filterLineOf(search.itemTypes, search.tags, t)
            return (
              <p key={`${search.callId}-${index}`} className={css.note}>
                {`${t('scopeLine')} ${scopeLabelOf(search.scope, t)}`}
                {filters !== '' ? ` · ${t('filterLine')} ${filters}` : ''}
                {` · ${t('modeLine')} ${modeLabelOf(search.mode, t)}`}
              </p>
            )
          })}
          <p className={css.note}>{`${t('refLine')} ${item.ref}`}</p>
        </div>
      )}
    </div>
  )
}
