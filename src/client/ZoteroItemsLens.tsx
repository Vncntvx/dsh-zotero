/**
 * The items lens: the session's found set as one expandable row per item —
 * the session organized by the user's literature instead of the agent's
 * actions. The list holds the final search's hit set (with a provenance
 * caption) plus any worked-on items reached outside it; badges mark what
 * the session read, cited, or resolved. The collapsed line carries the
 * best-known metadata, usage badges, and the two line-end actions (copy
 * ref, ask about this). Rows expand only when the session actually gathered
 * dossier content (notes/annotation previews, evidence passages, an
 * attachment location) — a searched-only row never invites an empty
 * expansion. Actions land back in the conversation: the ask button prefills
 * the composer through the injected setDraft (never submits).
 * @module dsh-zotero/client/ZoteroItemsLens
 */

import clsx from 'clsx'
import { IconBrowseOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { isWorkedOn, type Corpus, type CorpusItem } from './corpus.ts'
import { displayRefOf, interpolate, rowStateOf, type ZoteroRowState } from './presenters.ts'
import { ChildPreviewRow, CopyValue, EvidenceRow } from './ZoteroToolViews.tsx'
import { ZoteroToolRow } from './ZoteroToolRow.tsx'
import css from './ZoteroItemsLens.module.css'

export interface ZoteroItemsLensProps {
  readonly corpus: Corpus
  readonly t: TranslateNS<'zotero'>
  /** Composer prefill from the host props; absent in composer-less mounts. */
  readonly setDraft?: (text: string) => void
}

/** Worst lifecycle over the item's calls: running, then error, then stopped. */
function itemStateOf(item: CorpusItem): ZoteroRowState {
  let worst: ZoteroRowState = 'ok'
  for (const call of item.calls) {
    const state = rowStateOf(call)
    if (state === 'running') return 'running'
    if (worst === 'ok' && state !== 'ok') worst = state
  }
  return worst
}

/**
 * Whether the dossier has anything beyond the line itself. A row the session
 * only searched is not expandable — there is nothing to expand into.
 */
function hasDossierContent(item: CorpusItem): boolean {
  return (
    item.notesPreview.length > 0 ||
    item.annotationsPreview.length > 0 ||
    item.evidence.length > 0 ||
    (item.attachment !== undefined && item.attachment.location !== '')
  )
}

/** The usage badges trailing the collapsed line; null when none apply. */
function badgesOf(item: CorpusItem, t: ZoteroItemsLensProps['t']) {
  const parts: JSX.Element[] = []
  if (item.usage.read) {
    parts.push(
      <span key="read" className={clsx(css.badge, css.badgeNeutral)}>
        {t('badgeRead')}
      </span>,
    )
  }
  if (item.usage.cited) {
    parts.push(
      <span key="cited" className={clsx(css.badge, css.badgeBusiness)}>
        {t('badgeCited')}
      </span>,
    )
  }
  if (item.attachment?.contentType === 'application/pdf') {
    parts.push(
      <span key="pdf" className={clsx(css.badge, css.badgeMono)}>
        {t('badgePdf')}
      </span>,
    )
  }
  return parts.length === 0 ? null : <>{parts}</>
}

/**
 * The line-end actions every row carries: copy the ref, and (with a composer
 * face) prefill the ask template. Rendered outside the row's toggle.
 */
function RowActions({
  item,
  t,
  setDraft,
}: {
  readonly item: CorpusItem
  readonly t: ZoteroItemsLensProps['t']
  readonly setDraft: ((text: string) => void) | undefined
}) {
  return (
    <>
      <CopyValue value={item.ref} t={t} label={t('copyRef')} />
      {setDraft !== undefined && (
        <button
          type="button"
          className={css.actionButton}
          onClick={() => {
            setDraft(interpolate(t('askTemplate'), { ref: item.ref }))
          }}
        >
          {t('askAboutItem')}
        </button>
      )}
    </>
  )
}

/** One item's expanded dossier: the aggregated facts, sections only. */
function Dossier({
  item,
  t,
}: {
  readonly item: CorpusItem
  readonly t: ZoteroItemsLensProps['t']
}) {
  return (
    <div className={css.dossier}>
      {item.notesPreview.length > 0 && (
        <section className={css.section}>
          <span className={css.sectionLabel}>{t('personalNotes')}</span>
          {item.notesPreview.map((note) => (
            <ChildPreviewRow key={note.ref} preview={note} label={t('personalNotes')} t={t} />
          ))}
        </section>
      )}
      {item.annotationsPreview.length > 0 && (
        <section className={css.section}>
          <span className={css.sectionLabel}>{t('personalAnnotations')}</span>
          {item.annotationsPreview.map((annotation) => (
            <ChildPreviewRow
              key={annotation.ref}
              preview={annotation}
              label={t('personalAnnotations')}
              t={t}
            />
          ))}
        </section>
      )}
      {item.evidence.length > 0 && (
        <section className={css.section}>
          <span className={css.sectionLabel}>
            {interpolate(t('evidencePassages'), { count: item.evidence.length })}
          </span>
          {item.evidence.map((evidence, index) => (
            <EvidenceRow key={`${evidence.sourceRef}-${index}`} item={evidence} t={t} />
          ))}
        </section>
      )}
      {item.attachment !== undefined && item.attachment.location !== '' && (
        <div className={css.attachmentRow}>
          <span className={css.attachmentKind}>
            {item.attachment.kind === 'file' ? t('localFile') : t('linkedUrl')}
          </span>
          <code className={css.location} title={item.attachment.location}>
            {item.attachment.location}
          </code>
          <CopyValue value={item.attachment.location} t={t} />
        </div>
      )}
    </div>
  )
}

/** The items lens: provenance caption, one row per item, honest boundaries. */
export function ZoteroItemsLens({ corpus, t, setDraft }: ZoteroItemsLensProps) {
  if (corpus.items.length === 0) {
    return <p className={css.empty}>{t('itemsEmptyNote')}</p>
  }
  return (
    <>
      {/* One quiet line stating what the list is, so a small target list
          never reads as a glitch. */}
      {corpus.items.some(isWorkedOn) ? (
        <p className={css.sourceNote}>{t('itemsProcessedNote')}</p>
      ) : (
        corpus.searched > 0 && (
          <p className={css.sourceNote}>
            {corpus.searchOmitted > 0
              ? // The list shows the found set's rows; the omitted rows of
                // the bounded projection add back to the honest hit total.
                interpolate(t('itemsSourceOmittedNote'), {
                  count: corpus.searched + corpus.searchOmitted,
                  shown: corpus.searched,
                })
              : interpolate(t('itemsSourceNote'), { count: corpus.searched })}
          </p>
        )
      )}
      {corpus.items.map((item) => {
        const badges = badgesOf(item, t)
        const summary = [
          item.creators ?? '',
          item.year === undefined ? '' : String(item.year),
          item.venue ?? '',
        ]
          .filter((part) => part !== '')
          .join(' · ')
        return (
          <ZoteroToolRow
            key={item.key}
            state={itemStateOf(item)}
            title={item.title ?? displayRefOf(item.ref)}
            summary={summary}
            icon={<IconBrowseOutline16 size={14} />}
            facts={item.itemType === undefined ? [] : [item.itemType]}
            trailing={badges}
            actions={<RowActions item={item} t={t} setDraft={setDraft} />}
            expandable={hasDossierContent(item)}
            inspectLabel={t('inspectLabel')}
            runningLabel={t('checking')}
            errorLabel={t('statusUnavailable')}
            stoppedLabel={t('statusUnavailable')}
          >
            <Dossier item={item} t={t} />
          </ZoteroToolRow>
        )
      })}
    </>
  )
}
