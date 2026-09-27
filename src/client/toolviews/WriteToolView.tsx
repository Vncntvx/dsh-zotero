/**
 * Dedicated toolview cards for Zotero write operations:
 * `zotero_create_note`, `zotero_add_tags`, and `zotero_add_to_collection`.
 * Renders write receipts, tags, and plan-review decline notices.
 * @module dsh-zotero/client/toolviews/WriteToolView
 */

import { useMemo } from 'react'
import {
  IconBranchOutlineRegular,
  IconEditOutlineRegular,
  IconPlusOutlineRegular,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { ZoteroOpenLink } from '../components/open/ZoteroOpenLink.tsx'
import { selectUrlOf } from '../actions/open-zotero.ts'
import { writeMetaOf } from '../sources/decoders.ts'
import {
  argsOf,
  errorSummaryOf,
  metaOf,
  resultTextOf,
  shortKeyOf,
  stringField,
} from '../presenters.ts'
import { RunningNotice, RawTextFallback, ZoteroToolRow } from './ZoteroToolRow.tsx'
import css from './toolviews.module.css'

export type WriteToolViewProps = PropsRuntime<
  'tool.call.toolview',
  'zotero_create_note' | 'zotero_add_tags' | 'zotero_add_to_collection'
> &
  PropsLocale<'zotero'>

/**
 * What the receipt may claim about the write:
 *
 * - `applied` — the projection reported the applied fact, and it was a change.
 * - `noop` — the projection reported it, and nothing changed.
 * - `unreported` — the projection carried no applied fact at all (a nested
 *   code dispatch or a malformed replay record). The write may or may not have
 *   landed, so the badge says so and the summary states only the request; the
 *   tool's own rendered text below carries whatever it did conclude.
 *
 * `zotero_create_note` has no `unreported` arm, and that asymmetry is
 * deliberate: a note's applied fact *is* the row's `ok` state, which the
 * settled block already carries, so there is no second field that could go
 * missing. The two merge writes each report a separate boolean beside that
 * state, so for them a missing field is a real gap in the evidence.
 */
type ReceiptTone = 'applied' | 'noop' | 'unreported'

/**
 * The badge each claim wears: the word on it and the tone behind it, paired so
 * a fourth tone cannot be added to one half and forgotten in the other.
 */
const RECEIPT_BADGE = {
  applied: { label: 'badgeSuccess', tone: 'success' },
  noop: { label: 'badgeNoOp', tone: 'info' },
  // `unreported` is a warning, not the informational `noop`: nothing was proven
  // either way, which is a weaker position than a proven no-change and must
  // not read like one.
  unreported: { label: 'badgeUnreported', tone: 'warning' },
} as const satisfies Record<
  ReceiptTone,
  {
    readonly label: 'badgeSuccess' | 'badgeNoOp' | 'badgeUnreported'
    readonly tone: 'success' | 'info' | 'warning'
  }
>

function noteTitleOf(markdown: string | undefined, defaultTitle: string): string {
  if (!markdown) return defaultTitle
  const firstLine = markdown
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.length > 0)
  if (!firstLine) return defaultTitle
  const cleaned = firstLine.replace(/^[#*> \-\t]+/, '').trim()
  return cleaned || defaultTitle
}

export function WriteToolView(props: WriteToolViewProps) {
  const { toolName, block, useDisclosure, inspect, t } = props

  const {
    icon,
    title,
    summary,
    tone,
    errorSummary,
    parentRef,
    parentSelectUrl,
    tagsList,
    rawText,
  } = useMemo(() => {
    const args = argsOf(block)
    const raw = (resultTextOf(block) ?? '').trim()

    let ic = <IconEditOutlineRegular size={14} />
    let tit = t('toolTitleCreateNote')
    let sum = ''
    let tone: ReceiptTone = 'applied'

    const tags = Array.isArray(args?.['tags'])
      ? (args['tags'].filter((x) => typeof x === 'string') as string[])
      : []
    // Each write tool reports the fact only it knows: how many tags it
    // actually added, whether it added the membership at all. The requested
    // arguments are what the plan card showed the user, not what landed.
    const meta = metaOf(block)
    const write = meta !== null ? writeMetaOf(meta) : null

    if (toolName === 'zotero_add_tags') {
      ic = <IconPlusOutlineRegular size={14} />
      tit = t('toolTitleAddTags')
      if (write === null || write.addedCount === null) {
        sum = t('toolSummaryAddTagsRequested', { count: tags.length })
        tone = 'unreported'
      } else if (write.addedCount === 0) {
        sum = t('toolNoTagsAdded')
        tone = 'noop'
      } else {
        sum = t('toolSummaryAddTags', { count: write.addedCount })
      }
    } else if (toolName === 'zotero_add_to_collection') {
      ic = <IconBranchOutlineRegular size={14} />
      tit = t('toolTitleAddToCollection')
      const collectionArg = stringField(args ?? {}, 'collection') ?? ''
      const collectionName = shortKeyOf(collectionArg) ?? collectionArg.trim()
      if (write?.added === false) {
        sum = t('toolSummaryAddToCollectionNoop', { name: collectionName })
        tone = 'noop'
      } else if (write?.added === true) {
        sum = t('toolSummaryAddToCollection', { name: collectionName })
      } else {
        // The membership's fate is unknown, so the receipt cannot say it was
        // added any more than it can say it was not.
        sum = t('toolSummaryAddToCollectionRequested', { name: collectionName })
        tone = 'unreported'
      }
    } else {
      // zotero_create_note
      const markdown = stringField(args ?? {}, 'markdown')
      const noteTitle = noteTitleOf(markdown, t('toolDefaultNoteTitle'))
      sum = t('toolSummaryCreateNote', { title: noteTitle })
    }

    const errSummary = errorSummaryOf(block, raw)
    const pRef = stringField(args ?? {}, 'parentItem') ?? stringField(args ?? {}, 'ref')
    const pUrl = pRef ? selectUrlOf(pRef) : null

    return {
      icon: ic,
      title: tit,
      summary: sum,
      tone,
      errorSummary: errSummary,
      parentRef: pRef,
      parentSelectUrl: pUrl,
      tagsList: tags,
      rawText: raw,
    }
  }, [block, t, toolName])

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
      errorSummary={errorSummary}
    >
      {({ isRunning, isDeclined, isUnverified, state }) => {
        if (isRunning) {
          return <RunningNotice text={t('toolRunning')} />
        }
        if (isDeclined) {
          return (
            <div className={css.receiptCard} data-state="declined">
              <span className={css.badge} data-tone="warning">
                {t('toolDeclined')}
              </span>
              <div className={css.itemMeta}>{rawText}</div>
            </div>
          )
        }
        if (isUnverified) {
          // The tool's own sentence is the receipt: it names whether the
          // commit itself was unproven, and it carries the do-not-retry
          // instruction. Restating it here would be a second wording of the
          // write boundary's most consequential message — and the collapsed
          // line already carries the label, so the body adds only the detail.
          return (
            <div className={css.receiptCard} data-state="unverified">
              <span className={css.sectionTitle}>{t('toolUnverifiedDetail')}</span>
              <div className={css.itemMeta}>{rawText}</div>
            </div>
          )
        }
        if (state === 'error') {
          return (
            <div className={css.receiptCard}>
              <div className={css.itemHeader}>
                <span className={css.badge} data-tone="danger">
                  {t('toolFailed')}
                </span>
                <span className={css.receiptTitle}>{errorSummary}</span>
              </div>
              {rawText && <RawTextFallback text={rawText} />}
            </div>
          )
        }
        return (
          <div className={css.receiptCard} data-state={tone}>
            <div className={css.itemHeader}>
              <span className={css.badge} data-tone={RECEIPT_BADGE[tone].tone}>
                {t(RECEIPT_BADGE[tone].label)}
              </span>
              <span className={css.receiptTitle}>{summary}</span>
            </div>

            {parentSelectUrl && parentRef && (
              <div className={css.itemActions}>
                <span className={css.itemMeta}>{t('toolParentItem')}:</span>
                <ZoteroOpenLink
                  url={parentSelectUrl}
                  verdict="open"
                  label={parentRef}
                  t={t}
                  className={css.actionLink}
                />
              </div>
            )}

            {tagsList.length > 0 && (
              <div className={css.notesSection}>
                <span className={css.sectionTitle}>{t('toolTags')}</span>
                <div className={css.tagPills}>
                  {/* The pills list the tags the plan card showed the user, so
                      they wear the receipt's own tone: a proven change reads at
                      full strength, anything else as a statement about the plan
                      rather than about the library. */}
                  {tagsList.map((tag) => (
                    <span
                      key={tag}
                      className={css.badge}
                      data-tone={tone === 'applied' ? undefined : RECEIPT_BADGE[tone].tone}
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {rawText && <RawTextFallback text={rawText} />}
          </div>
        )
      }}
    </ZoteroToolRow>
  )
}
