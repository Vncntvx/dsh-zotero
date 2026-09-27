/**
 * Dedicated toolview card for `zotero_get`.
 * Renders paper metadata, publication venues, attachments, and Zotero open links.
 * @module dsh-zotero/client/toolviews/ItemToolView
 */

import { useMemo, type ReactNode } from 'react'
import { IconDeliverDocRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { getMetaOf, type ChildCountView, type ChildPreviewView } from '../sources/decoders.ts'
import { childRowLinks, pdfUrlOf, selectUrlOf } from '../actions/open-zotero.ts'
import { ZoteroOpenLink } from '../components/open/ZoteroOpenLink.tsx'
import { countOfLabel, CHILD_KIND_LABEL } from '../evidence-labels.ts'
import { argsOf, errorSummaryOf, metaOf, resultTextOf, stringField } from '../presenters.ts'
import { RawTextFallback, RunningNotice, ZoteroToolRow } from './ZoteroToolRow.tsx'
import css from './toolviews.module.css'

export type ItemToolViewProps = PropsRuntime<'tool.call.toolview', 'zotero_get'> &
  PropsLocale<'zotero'>

/** One preview row with the deep links its own kind can offer. */
interface PreviewView {
  readonly key: string
  readonly preview: string
  readonly pageLabel: string | null
  readonly selectUrl: string | null
  /** Open the PDF an annotation lives in, at its page. */
  readonly pdfUrl: string | null
}

/**
 * One child preview with the links its kind supports, through the shared
 * `childRowLinks`: a note's parent is the item this card is already about, so
 * only the note is worth linking, while an annotation's parent is its PDF,
 * which is where the reader wants to land.
 */
function previewView(
  preview: ChildPreviewView,
  index: number,
  kind: 'note' | 'annotation',
): PreviewView {
  const { selectUrl, pdfUrl } = childRowLinks({
    ref: preview.ref,
    parentRef: preview.parentRef,
    pageLabel: preview.pageLabel,
    kind,
  })
  return {
    key: `${preview.ref}-${index}`,
    preview: preview.preview,
    pageLabel: preview.pageLabel,
    selectUrl,
    pdfUrl,
  }
}

export function ItemToolView(props: ItemToolViewProps) {
  const { toolName, block, useDisclosure, inspect, t } = props

  const {
    icon,
    ref,
    summary,
    errorSummary,
    getItemView,
    selectUrl,
    pdfUrl,
    childCounts,
    notePreviews,
    annotationPreviews,
    rawText,
  } = useMemo(() => {
    const args = argsOf(block)
    const itemRef = stringField(args ?? {}, 'ref') ?? ''
    const meta = metaOf(block)
    const view = meta !== null ? getMetaOf(meta) : null
    const raw = (resultTextOf(block) ?? '').trim()

    let sum = ''
    if ('phase' in block && block.phase === 'start') {
      sum = itemRef || t('toolTitleGet')
    } else if (view?.title) {
      sum =
        view.year !== null && view.year !== undefined && !view.title.includes(String(view.year))
          ? t('toolSummaryItem', {
              title: view.title,
              year: String(view.year),
            })
          : view.title
    } else {
      sum = itemRef || t('toolTitleGet')
    }

    const errSummary = errorSummaryOf(block, raw)
    const sUrl = itemRef ? selectUrlOf(itemRef) : null
    const pUrl = view?.bestAttachment?.ref ? pdfUrlOf(view.bestAttachment.ref) : null

    // The child counts and previews the projection already carried. The
    // Sources panel has always read them; the card now does too, so a reader
    // who asks "does this paper have my notes?" learns it in place. A kind the
    // call did not ask for is absent from the projection, and `flatMap` below
    // keeps it out of the badges rather than rendering it as zero.
    const notesPreviews = view?.notesPreview ?? []
    const annotationPreviews = view?.annotationsPreview ?? []
    // `shown` is what the card actually draws, not what the projection returned:
    // the preview lists are capped independently, so a paper with 50 notes
    // would otherwise be captioned "50 shown" over two preview rows. It is
    // `null` for a kind this card draws no list of at all — attachments get a
    // count only, and pairing that count with a "shown" of zero would claim
    // nothing was drawn when the question was never on the table.
    const counts: readonly {
      readonly key: string
      readonly count: ChildCountView | null
      readonly shown: number | null
      readonly label: string
    }[] = [
      {
        key: 'notes',
        count: view?.notes ?? null,
        shown: notesPreviews.length,
        label: t(CHILD_KIND_LABEL.note),
      },
      {
        key: 'annotations',
        count: view?.annotations ?? null,
        shown: annotationPreviews.length,
        label: t(CHILD_KIND_LABEL.annotation),
      },
      {
        key: 'attachments',
        count: view?.attachments ?? null,
        shown: null,
        label: t(CHILD_KIND_LABEL.attachment),
      },
    ]

    return {
      icon: <IconDeliverDocRegular size={14} />,
      ref: itemRef,
      summary: sum,
      errorSummary: errSummary,
      getItemView: view,
      selectUrl: sUrl,
      pdfUrl: pUrl,
      childCounts: counts.flatMap(({ key, count, shown, label }) =>
        // A kind the call did not ask for is absent, not zero: "no notes
        // exist" and "notes were not requested" are different facts.
        count === null ? [] : [{ key, label, count, shown }],
      ),
      notePreviews: notesPreviews.map((preview, index) => previewView(preview, index, 'note')),
      annotationPreviews: annotationPreviews.map((preview, index) =>
        previewView(preview, index, 'annotation'),
      ),
      rawText: raw,
    }
  }, [block, t])

  const previewSection = (label: string, previews: readonly PreviewView[]): ReactNode | null => {
    if (previews.length === 0) return null
    return (
      <div className={css.notesSection}>
        <span className={css.sectionTitle}>{label}</span>
        <div className={css.cardList}>
          {previews.map((preview) => (
            <div key={preview.key} className={css.itemCard} data-child-row>
              <div className={css.itemHeader}>
                {preview.pageLabel !== null && (
                  <span className={css.badge}>{preview.pageLabel}</span>
                )}
                <span className={css.itemMeta}>{preview.preview}</span>
              </div>
              <div className={css.itemActions}>
                {preview.pdfUrl !== null && (
                  <ZoteroOpenLink
                    url={preview.pdfUrl}
                    verdict="open"
                    label={t('openPdf')}
                    t={t}
                    className={css.actionLink}
                  />
                )}
                {preview.selectUrl !== null && (
                  <ZoteroOpenLink
                    url={preview.selectUrl}
                    verdict="open"
                    label={t('openInZotero')}
                    t={t}
                    className={css.actionLink}
                  />
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  return (
    <ZoteroToolRow
      toolName={toolName}
      block={block}
      useDisclosure={useDisclosure}
      inspect={inspect}
      t={t}
      icon={icon}
      title={t('toolTitleGet')}
      summary={summary}
      summarySuffix={null}
      errorSummary={errorSummary}
    >
      {({ isRunning }) => {
        if (isRunning) {
          return <RunningNotice text={t('toolRunning')} />
        }

        return (
          <>
            <div className={css.itemCard}>
              <div className={css.itemHeader}>
                {getItemView?.year !== null && getItemView?.year !== undefined && (
                  <span className={css.badge}>{getItemView.year}</span>
                )}
                {getItemView?.bestAttachment && (
                  <span className={css.badge} data-tone="pdf">
                    {t('badgePdf')}
                  </span>
                )}
                <span className={css.itemTitle}>{getItemView?.title ?? ref}</span>
              </div>

              {getItemView?.creators && <div className={css.itemMeta}>{getItemView.creators}</div>}
              {getItemView?.venue && <div className={css.itemMeta}>{getItemView.venue}</div>}

              {childCounts.length > 0 && (
                <div className={css.evidenceBadges}>
                  {childCounts.map((entry) => (
                    <span key={entry.key} className={css.badge} data-child-count={entry.key}>
                      {entry.shown === null
                        ? // No list of this kind on this card, so there is nothing
                          // to pair the count against: state the count itself.
                          `${entry.label} ${entry.count.returned}`
                        : `${entry.label} ${countOfLabel(entry.count.total, entry.shown, t)}`}
                    </span>
                  ))}
                </div>
              )}

              <div className={css.itemActions}>
                {selectUrl && (
                  <ZoteroOpenLink
                    url={selectUrl}
                    verdict="open"
                    label={t('openInZotero')}
                    t={t}
                    className={css.actionLink}
                  />
                )}
                {pdfUrl && (
                  <ZoteroOpenLink
                    url={pdfUrl}
                    verdict="open"
                    label={t('openPdf')}
                    t={t}
                    className={css.actionLink}
                  />
                )}
              </div>
            </div>

            {previewSection(t(CHILD_KIND_LABEL.note), notePreviews)}
            {previewSection(t(CHILD_KIND_LABEL.annotation), annotationPreviews)}

            {rawText && <RawTextFallback text={rawText} />}
          </>
        )
      }}
    </ZoteroToolRow>
  )
}
