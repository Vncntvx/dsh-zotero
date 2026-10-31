/**
 * The inspector's overview panel: what the user can do with the item first,
 * where it came from second. The action row leads (read PDF in the sidebar,
 * copy title / copy link, ask, export citation, copy ref) as one flat row of
 * visible actions: the copy belongs beside its siblings, not folded into an
 * overflow menu whose single item sat ~190px from its own trigger.
 * Below it every search occurrence is the audit record, in the first screen
 * without expanding anything: query (or the browse marker) with scope and
 * mode, the active filters, and the episode's hit counts. The "technical
 * details" disclosure keeps only the raw ref, developer data that must not
 * compete with the audit record. Only the PDF read is instance-guarded (a
 * mismatched ref may resolve to the wrong document); the clipboard actions
 * never are.
 * @module dsh-zotero/client/components/workspace/SourceOverview
 */

import { useMemo, useState } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { ZoteroAttachmentLocationView } from '../../../contract.ts'
import { askDraftOf, exportDraftOf } from '../../actions/source-actions.ts'
import type { SearchOccurrence, SourceItem } from '../../sources/model.ts'
import { pdfCapabilityOf } from '../../sources/source-capabilities.ts'
import { BlockedReadAction } from '../open/BlockedReadAction.tsx'
import { PdfReadButton } from '../open/PdfReadButton.tsx'
import { ZoteroLocateActions } from '../open/ZoteroLocateActions.tsx'
import css from './workspace.module.css'
import quiet from '../quiet.module.css'

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
  // The audit lines are formatted once per data/locale change: the inspector
  // re-renders on view-local state, and every label and t() call used to be
  // recomputed per occurrence on each of those renders.
  const searchRows = useMemo(
    () =>
      item.searches.map((search, index) => {
        const scope = scopeLabelOf(search.scope, t)
        const mode = modeLabelOf(search.mode, t)
        const filters = filterLineOf(search.itemTypes, search.tags, t)
        // The note supplement is a second count on the same line: the first
        // screen answers "how many hits, and did notes add any" at a glance.
        const hits =
          search.total === undefined
            ? t('searchEpisodeHitsNoTotal', { returned: search.returned })
            : t('searchEpisodeHitsLine', { returned: search.returned, total: search.total })
        const hitsWithNotes =
          search.noteMatches === undefined
            ? hits
            : `${hits} · ${t('searchEpisodeNoteHits', { noteMatches: search.noteMatches })}`
        const queryLine =
          search.query !== undefined
            ? t('searchEpisodeQueryLine', { query: search.query, scope, mode })
            : t('searchEpisodeNoQueryLine', { scope, mode })
        return { key: `${search.callId}-${index}`, queryLine, filters, hitsWithNotes }
      }),
    [item.searches, t],
  )

  return (
    <div className={css.panel}>
      <div className={css.actionRow}>
        {pdfCapability !== null &&
          (evidenceMatch === 'mismatch' ? (
            <BlockedReadAction label={t('readPdf')} t={t} className={quiet.quiet} />
          ) : (
            <PdfReadButton
              capability={pdfCapability}
              onOpenFile={openFile}
              resolveAttachment={resolveAttachment}
              label={t('readPdf')}
              t={t}
              className={quiet.quiet}
            />
          ))}
        <ZoteroLocateActions title={item.title} itemRef={item.ref} t={t} className={quiet.quiet} />
        {setDraft !== undefined && (
          <Button
            variant="outline"
            size="sm"
            className={quiet.quiet}
            onClick={() => {
              setDraft(askDraftOf(item.ref, t))
            }}
          >
            {t('askAboutItem')}
          </Button>
        )}
        {setDraft !== undefined && (
          <Button
            variant="outline"
            size="sm"
            className={quiet.quiet}
            onClick={() => {
              setDraft(exportDraftOf(item.ref, t))
            }}
          >
            {t('exportCitation')}
          </Button>
        )}
      </div>
      {item.evidenceMatch === 'mismatch' && <p className={css.warning}>{t('databaseMismatch')}</p>}
      {searchRows.length > 0 ? (
        searchRows.map((search) => (
          <div key={search.key} className={css.section}>
            <p className={css.line}>{search.queryLine}</p>
            {search.filters !== '' && (
              <p className={css.note}>
                {t('searchEpisodeFilterLine', { filters: search.filters })}
              </p>
            )}
            <p className={css.line}>{search.hitsWithNotes}</p>
          </div>
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
          <p className={css.note}>{`${t('refLine')} ${item.ref}`}</p>
        </div>
      )}
    </div>
  )
}
