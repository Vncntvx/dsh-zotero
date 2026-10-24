/**
 * Dedicated toolview card for `zotero_get`.
 * Renders paper metadata, publication venues, attachments, and Zotero open links.
 * @module dsh-zotero/client/toolviews/ItemToolView
 */

import { useMemo, type ReactNode } from 'react'
import { IconDeliverDocRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { getMetaOf, type ChildCountView, type ChildPreviewView } from '../sources/decoders.ts'
import { PdfReadButton } from '../components/open/PdfReadButton.tsx'
import { ZoteroLocateActions } from '../components/open/ZoteroLocateActions.tsx'
import { countOfLabel, CHILD_KIND_LABEL } from '../evidence-labels.ts'
import {
  argsViewOf,
  errorSummaryOf,
  isToolRunning,
  metaOf,
  resultTextOf,
  textArg,
} from '../presenters.ts'
import { RawTextFallback, RunningNotice, ZoteroToolRow } from './ZoteroToolRow.tsx'
import css from './toolviews.module.css'

type ItemToolViewProps = PropsRuntime<'tool.call.toolview', 'zotero_get'> & PropsLocale<'zotero'>

/** One preview row with the deep links its own kind can offer. */
interface PreviewView {
  readonly key: string
  readonly preview: string
  readonly pageLabel: string | null
  readonly ref: string
  readonly parentRef: string | null
}

/** One child preview with the links its kind supports. */
function previewView(preview: ChildPreviewView, index: number): PreviewView {
  return {
    key: `${preview.ref}-${index}`,
    preview: preview.preview,
    pageLabel: preview.pageLabel,
    ref: preview.ref,
    parentRef: preview.parentRef ?? null,
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
    childCounts,
    notePreviews,
    annotationPreviews,
    detailOmitted,
    rawText,
  } = useMemo(() => {
    const args = argsViewOf(block)
    const itemRef = textArg(args, 'ref') ?? ''
    const meta = metaOf(block)
    const view = meta !== null ? getMetaOf(meta) : null
    const raw = (resultTextOf(block) ?? '').trim()

    let sum = ''
    if (isToolRunning(block)) {
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
    // `null` for a kind this card draws no list of at all: attachments get a
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
      childCounts: counts.flatMap(({ key, count, shown, label }) =>
        // A kind the call did not ask for is absent, not zero: "no notes
        // exist" and "notes were not requested" are different facts.
        count === null ? [] : [{ key, label, count, shown }],
      ),
      detailOmitted: view?.detailOmitted === true,
      notePreviews: notesPreviews.map((preview, index) => previewView(preview, index)),
      annotationPreviews: annotationPreviews.map((preview, index) => previewView(preview, index)),
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
                {preview.parentRef !== null && (
                  <PdfReadButton
                    attachmentRef={preview.parentRef}
                    onOpenFile={props.openFile}
                    label={t('readPdf')}
                    t={t}
                    variant="link"
                    className={css.actionLink}
                  />
                )}
                <ZoteroLocateActions
                  itemRef={preview.ref}
                  variant="link"
                  className={css.actionLink}
                  t={t}
                />
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
                {getItemView?.bestAttachment?.ref && (
                  <PdfReadButton
                    attachmentRef={getItemView.bestAttachment.ref}
                    onOpenFile={props.openFile}
                    label={t('readPdf')}
                    t={t}
                    variant="link"
                    className={css.actionLink}
                  />
                )}
                <ZoteroLocateActions
                  title={getItemView?.title}
                  itemRef={ref}
                  t={t}
                  variant="link"
                  className={css.actionLink}
                />
              </div>
            </div>

            {previewSection(t(CHILD_KIND_LABEL.note), notePreviews)}
            {previewSection(t(CHILD_KIND_LABEL.annotation), annotationPreviews)}

            {rawText && <RawTextFallback text={rawText} />}

            {detailOmitted && <div className={css.coverageNotice}>{t('detailOmittedNote')}</div>}
          </>
        )
      }}
    </ZoteroToolRow>
  )
}
