/**
 * The inspector's overview panel: the item's identity and the search
 * provenance that surfaced it — the episode's mode, scope, and filter
 * fields, displayed from the stored episode facts (never re-parsed). The
 * open-in-Zotero and open-PDF actions are provenance-guarded exactly like
 * the row actions, plus copy-ref and the composer prefills.
 * @module dsh-zotero/client/components/workspace/SourceOverview
 */

import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { askDraftOf, exportDraftOf } from '../../actions/source-actions.ts'
import { openVerdictOf, selectUrlOf } from '../../actions/open-zotero.ts'
import { interpolate } from '../../presenters.ts'
import type { SearchProvenance, SourceItem } from '../../sources/model.ts'
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
export function scopeLabelOf(scope: SearchProvenance['scope'], t: TranslateNS<'zotero'>): string {
  switch (scope.kind) {
    case 'library':
      return t('overviewScopeLibrary')
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
  t: TranslateNS<'zotero'>,
): string {
  const parts = [...itemTypes, ...tags]
  return parts.length === 0 ? '' : parts.join(' · ')
}

export interface SourceOverviewProps {
  readonly item: SourceItem
  readonly t: TranslateNS<'zotero'>
  readonly setDraft?: (text: string) => void
}

/** The overview panel: identity, provenance lines, and the guarded actions. */
export function SourceOverview({ item, t, setDraft }: SourceOverviewProps) {
  const verdict = openVerdictOf(item)
  const selectUrl = selectUrlOf(item.ref)
  const pdfCapability = pdfCapabilityOf(item)
  const latestSearch = item.searches[item.searches.length - 1]
  return (
    <div className={css.panel}>
      {item.searches.length > 0 && (
        <div className={css.section}>
          <p className={css.sectionLabel}>{t('fromSearches')}</p>
          {item.searches.map((search, index) => {
            const filters = filterLineOf(search.itemTypes, search.tags, t)
            return (
              <p key={`${search.callId}-${index}`} className={css.line}>
                {search.query !== undefined
                  ? interpolate(t('searchFrom'), { query: search.query })
                  : t('searchFromBrowse')}
                {` · ${t('scopeLine')} ${scopeLabelOf(search.scope, t)}`}
                {filters !== '' ? ` · ${t('filterLine')} ${filters}` : ''}
                {` · ${t('modeLine')} ${modeLabelOf(search.mode, t)}`}
              </p>
            )
          })}
        </div>
      )}
      {latestSearch === undefined && <p className={css.line}>{t('overviewNoSearch')}</p>}
      <div className={css.section}>
        <p className={css.sectionLabel}>{t('overviewFacts')}</p>
        <p className={css.line}>
          {interpolate(t('evidenceInDetail'), { count: item.facts.evidenceCount })}
        </p>
        {item.facts.reportedEvidenceCount > item.facts.evidenceCount && (
          <p className={css.line}>
            {interpolate(t('reportedEvidenceInDetail'), {
              count: item.facts.reportedEvidenceCount,
            })}
          </p>
        )}
        <p className={css.line}>
          {interpolate(t('exportsInDetail'), { count: item.facts.exportCount })}
        </p>
        {item.provenance === 'mismatch' && <p className={css.warning}>{t('provenanceMismatch')}</p>}
      </div>
      <div className={css.section}>
        <p className={css.sectionLabel}>{t('overviewActions')}</p>
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
          <CopyButton value={item.ref} label={t('copyRef')} copiedLabel={t('copied')} />
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
        </div>
      </div>
    </div>
  )
}
