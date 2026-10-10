/**
 * Dedicated toolview card for `zotero_children` and `zotero_attachment`.
 * Renders the child-object graph by kind (notes, attachments, and PDF
 * annotations with their page labels and Zotero colours) plus the resolved
 * location of a single attachment.
 * @module dsh-zotero/client/toolviews/ChildrenToolView
 */

import { useMemo, type CSSProperties, type ReactNode } from 'react'
import { IconLinkOutlineMedium } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime, TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import {
  attachmentMetaOf,
  childrenMetaOf,
  type ChildRow,
  type ChildSection,
} from '../sources/decoders.ts'
import { childRowLinks, pdfUrlOf } from '../actions/open-zotero.ts'
import { ZoteroOpenLink } from '../components/open/ZoteroOpenLink.tsx'
import { CopyButton } from '../components/CopyButton.tsx'
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

export type ChildrenToolViewProps = PropsRuntime<
  'tool.call.toolview',
  'zotero_children' | 'zotero_attachment'
> &
  PropsLocale<'zotero'>

/** The heading each child kind is named by, wherever a card mentions it. */
const sectionLabelKeyOf = (kind: ChildRow['kind']): (typeof CHILD_KIND_LABEL)[ChildRow['kind']] =>
  CHILD_KIND_LABEL[kind]

/**
 * Zotero's annotation colour is data, not a design decision, so it is carried
 * through as a custom property rather than mapped onto the badge's severity
 * tones (a red highlight is not an error). Only the lengths CSS actually reads
 * pass, so an unparseable value yields no swatch at all rather than an empty
 * box painted by the property's fallback.
 */
const CSS_HEX = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i

function annotationColorVar(color: string | null): CSSProperties | undefined {
  if (color === null || !CSS_HEX.test(color)) return undefined
  return { '--zotero-annotation': color } as CSSProperties
}

/** One child row's own text: a note's body, an annotation's highlight. */
function rowTextOf(row: ChildRow): string {
  return row.kind === 'attachment' ? row.title : row.text
}

function ChildSectionView({
  section,
  t,
}: {
  readonly section: ChildSection
  readonly t: TranslateNS<'zotero'>
}): ReactNode {
  return (
    <div className={css.notesSection} data-child-kind={section.kind}>
      <span className={css.sectionTitle}>
        {`${t(sectionLabelKeyOf(section.kind))} · ${countOfLabel(section.total, section.shown, t)}`}
      </span>
      {section.rows.length === 0 ? (
        <div className={css.coverageNotice}>{t('toolChildrenNone')}</div>
      ) : (
        <div className={css.cardList}>
          {section.rows.map((row) => {
            const { selectUrl, pdfUrl } = childRowLinks(row)
            const swatch = annotationColorVar(row.kind === 'annotation' ? row.color : null)
            return (
              <div key={row.ref} className={css.itemCard} data-child-row={row.kind}>
                <div className={css.itemHeader}>
                  {swatch && <span className={css.annotationSwatch} style={swatch} aria-hidden />}
                  {row.kind === 'annotation' && row.pageLabel !== null && (
                    <span className={css.badge}>{row.pageLabel}</span>
                  )}
                  {row.kind === 'annotation' && <span className={css.badge}>{row.type}</span>}
                  {row.kind === 'attachment' && (
                    <span className={css.badge} data-tone="pdf">
                      {row.contentType}
                    </span>
                  )}
                  <span className={css.itemTitle}>{rowTextOf(row)}</span>
                </div>
                <div className={css.itemActions}>
                  {pdfUrl && (
                    <ZoteroOpenLink
                      url={pdfUrl}
                      verdict="open"
                      label={t('openPdf')}
                      t={t}
                      className={css.actionLink}
                    />
                  )}
                  {selectUrl && (
                    <ZoteroOpenLink
                      url={selectUrl}
                      verdict="open"
                      label={t('openInZotero')}
                      t={t}
                      className={css.actionLink}
                    />
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

export function ChildrenToolView(props: ChildrenToolViewProps) {
  const { toolName, block, useDisclosure, inspect, t } = props

  const isAttachment = toolName === 'zotero_attachment'
  const title = isAttachment ? t('toolTitleAttachment') : t('toolTitleChildren')

  const { icon, ref, summary, errorSummary, attachView, pdfUrl, sections, detailOmitted, rawText } =
    useMemo(() => {
      const args = argsViewOf(block)
      const itemRef = textArg(args, 'ref') ?? ''
      const meta = metaOf(block)
      const attachView = isAttachment && meta !== null ? attachmentMetaOf(meta) : null
      const children = !isAttachment && meta !== null ? childrenMetaOf(meta) : null
      const raw = (resultTextOf(block) ?? '').trim()

      // A kind the call did not ask for is absent from the projection, so the
      // count is over the kinds it did return, never a zero for an unasked kind.
      const childTotal = (children?.sections ?? []).reduce((sum, section) => sum + section.total, 0)

      let sum = ''
      if (isToolRunning(block)) {
        sum = itemRef || title
      } else if (attachView?.title) {
        sum = t('toolSummaryAttachment', { title: attachView.title })
      } else if ((children?.sections.length ?? 0) > 0) {
        sum = t('toolSummaryChildren', { count: childTotal })
      } else {
        sum = itemRef || title
      }

      const errSummary = errorSummaryOf(block, raw)
      const pUrl = attachView?.ref ? pdfUrlOf(attachView.ref) : null

      return {
        icon: <IconLinkOutlineMedium size={14} />,
        ref: itemRef,
        summary: sum,
        errorSummary: errSummary,
        attachView: attachView,
        pdfUrl: pUrl,
        sections: children?.sections ?? [],
        detailOmitted: (attachView?.detailOmitted ?? children?.detailOmitted) === true,
        rawText: raw,
      }
    }, [block, isAttachment, t, title])

  return (
    <ZoteroToolRow
      toolName={toolName}
      block={block}
      useDisclosure={useDisclosure}
      inspect={inspect}
      t={t}
      icon={icon}
      title={title}
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
            {detailOmitted && <div className={css.coverageNotice}>{t('detailOmittedNote')}</div>}
            {attachView && (
              <div className={css.itemCard}>
                <div className={css.itemHeader}>
                  {attachView.kind && (
                    <span className={css.badge}>{attachView.kind.toUpperCase()}</span>
                  )}
                  {attachView.contentType && (
                    <span className={css.badge} data-tone="pdf">
                      {attachView.contentType}
                    </span>
                  )}
                  <span className={css.itemTitle}>{attachView.title ?? ref}</span>
                </div>
                {attachView.location && <div className={css.itemMeta}>{attachView.location}</div>}
                <div className={css.itemActions}>
                  {/* The resolved path or URL is the whole point of the call, and
                      it is the one value a reader cannot retype from memory. */}
                  {attachView.location && (
                    <CopyButton
                      value={attachView.location}
                      label={t('copy')}
                      copiedLabel={t('copied')}
                      className={css.lineAction}
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
            )}

            {sections.map((section) => (
              <ChildSectionView key={section.kind} section={section} t={t} />
            ))}

            {rawText && <RawTextFallback text={rawText} />}
          </>
        )
      }}
    </ZoteroToolRow>
  )
}
