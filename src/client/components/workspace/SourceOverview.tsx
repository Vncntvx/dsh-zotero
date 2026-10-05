/**
 * The inspector's overview panel: what the user can do with the item first,
 * where it came from second. The action row leads (open in Zotero, open
 * PDF, ask, export citation, copy ref) as one flat row of visible actions —
 * the copy belongs beside its siblings, not folded into an overflow menu
 * whose single item sat ~190px from its own trigger.
 * Below it the search occurrences show just the query
 * per episode; scope, mode, and filter fields wait behind the "search
 * details" disclosure, together with the raw ref — developer facts that
 * must not compete with the primary actions. The open actions are
 * instance-guarded exactly like the row actions.
 * @module dsh-zotero/client/components/workspace/SourceOverview
 */

import { useState } from 'react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { askDraftOf, exportDraftOf } from '../../actions/source-actions.ts'
import { openVerdictOf, selectUrlOf } from '../../actions/open-zotero.ts'
import type { SearchOccurrence, SourceItem } from '../../sources/model.ts'
import { pdfCapabilityOf } from '../../sources/source-capabilities.ts'
import { CopyButton } from '../CopyButton.tsx'
import { BlockedOpenAction } from '../open/BlockedOpenAction.tsx'
import { ZoteroOpenButton } from '../open/ZoteroOpenButton.tsx'
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

export interface SourceOverviewProps {
  readonly item: SourceItem
  readonly t: TranslateNS<'zotero'>
  readonly setDraft?: (text: string) => void
}

/** The overview panel: guarded actions, search records, and the detail disclosure. */
export function SourceOverview({ item, t, setDraft }: SourceOverviewProps) {
  const [detailOpen, setDetailOpen] = useState(false)
  const verdict = openVerdictOf(item)
  const selectUrl = selectUrlOf(item.ref)
  const pdfCapability = pdfCapabilityOf(item)

  return (
    <div className={css.panel}>
      <div className={css.actionRow}>
        {selectUrl !== null &&
          (verdict === 'blocked' ? (
            <BlockedOpenAction label={t('openInZotero')} t={t} />
          ) : (
            <ZoteroOpenButton url={selectUrl} verdict={verdict} label={t('openInZotero')} t={t} />
          ))}
        {pdfCapability !== null &&
          (verdict === 'blocked' ? (
            <BlockedOpenAction label={t('openPdf')} t={t} />
          ) : (
            <ZoteroOpenButton
              url={pdfCapability.url}
              verdict={verdict}
              label={t('openPdf')}
              t={t}
            />
          ))}
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
