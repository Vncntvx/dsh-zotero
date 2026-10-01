/**
 * Dedicated toolview cards for Zotero write operations: the eight write
 * tools. Renders write receipts, tags, and plan-review decline notices.
 * Each tool is one descriptor (icon, title key, summary builder) in the
 * table below — the receipt body is shared, so adding a write tool means
 * adding one descriptor, not another branch in the body.
 * @module dsh-zotero/client/toolviews/WriteToolView
 */

import { useMemo } from 'react'
import type { ReactNode } from 'react'
import {
  IconBranchOutlineRegular,
  IconEditOutlineRegular,
  IconPlusOutlineRegular,
  IconTrashOutlineRegular,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { ZoteroOpenLink } from '../components/open/ZoteroOpenLink.tsx'
import { selectUrlOf } from '../actions/open-zotero.ts'
import { writeMetaOf, type WriteMetaView } from '../sources/decoders.ts'
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

/** The eight write tools this view renders. */
export type WriteToolName =
  | 'zotero_create_note'
  | 'zotero_update_item_tags'
  | 'zotero_update_item_collections'
  | 'zotero_create_collection'
  | 'zotero_delete_collection'
  | 'zotero_create_item'
  | 'zotero_update_item'
  | 'zotero_delete_library_tags'

export type WriteToolViewProps = PropsRuntime<'tool.call.toolview', WriteToolName> &
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
 * Creates have no `unreported` arm, and that asymmetry is deliberate: a
 * created object's applied fact *is* the row's `ok` state, which the settled
 * block already carries, so there is no second field that could go missing.
 * The two merge writes each report counts beside that state, so for them a
 * missing field is a real gap in the evidence.
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

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? (value.filter((x) => typeof x === 'string') as string[]) : []
}

/** What one tool's summary builder receives: the call, the projection, and the locale. */
interface DescribeContext {
  readonly args: Record<string, unknown> | null
  readonly write: WriteMetaView | null
  readonly t: WriteToolViewProps['t']
}

/** What one tool's receipt needs above the shared body. */
interface DescribedReceipt {
  readonly summary: string
  readonly tone: ReceiptTone
  readonly tags: string[]
  readonly parentRef?: string
}

/**
 * The per-tool row facts: icon, card title, and how to state the summary.
 * The icon is a factory, not a stored element: the table is evaluated at
 * module load, and building React elements belongs to render time.
 */
interface WriteDescriptor {
  readonly icon: () => ReactNode
  readonly titleKey: Parameters<WriteToolViewProps['t']>[0]
  readonly describe: (context: DescribeContext) => DescribedReceipt
}

/**
 * One entry per write tool. The requested arguments are what the plan card
 * showed the user, not what landed; each tool names only the fact it knows.
 */
const WRITE_DESCRIPTORS: Record<WriteToolName, WriteDescriptor> = {
  zotero_create_note: {
    icon: () => <IconEditOutlineRegular size={14} />,
    titleKey: 'toolTitleCreateNote',
    describe: ({ args, t }) => ({
      summary: t('toolSummaryCreateNote', {
        title: noteTitleOf(stringField(args ?? {}, 'markdown'), t('toolDefaultNoteTitle')),
      }),
      tone: 'applied',
      tags: stringList(args?.['tags']),
      parentRef: stringField(args ?? {}, 'parentItem') ?? stringField(args ?? {}, 'ref'),
    }),
  },
  zotero_update_item_tags: {
    icon: () => <IconPlusOutlineRegular size={14} />,
    titleKey: 'toolTitleUpdateItemTags',
    describe: ({ args, write, t }) => {
      const requested = [...stringList(args?.['add']), ...stringList(args?.['remove'])]
      if (write === null || (write.addedCount === null && write.removedCount === null)) {
        return {
          summary: t('toolSummaryUpdateItemTagsRequested', { count: requested.length }),
          tone: 'unreported',
          tags: requested,
          parentRef: stringField(args ?? {}, 'ref'),
        }
      }
      const added = write.addedCount ?? 0
      const removed = write.removedCount ?? 0
      return {
        summary:
          added === 0 && removed === 0
            ? t('toolNoTagsChanged')
            : t('toolSummaryUpdateItemTags', { added, removed }),
        tone: added === 0 && removed === 0 ? 'noop' : 'applied',
        tags: requested,
        parentRef: stringField(args ?? {}, 'ref'),
      }
    },
  },
  zotero_update_item_collections: {
    icon: () => <IconBranchOutlineRegular size={14} />,
    titleKey: 'toolTitleUpdateItemCollections',
    describe: ({ args, write, t }) => {
      const requested = [...stringList(args?.['add']), ...stringList(args?.['remove'])]
      if (write === null || (write.addedCount === null && write.removedCount === null)) {
        const name =
          requested[0] !== undefined ? (shortKeyOf(requested[0]) ?? requested[0].trim()) : ''
        return {
          summary: t('toolSummaryUpdateItemCollectionsRequested', { name }),
          tone: 'unreported',
          tags: [],
          parentRef: stringField(args ?? {}, 'ref'),
        }
      }
      const added = write.addedCount ?? 0
      const removed = write.removedCount ?? 0
      return {
        summary:
          added === 0 && removed === 0
            ? t('toolNoMembershipChanged')
            : t('toolSummaryUpdateItemCollections', { added, removed }),
        tone: added === 0 && removed === 0 ? 'noop' : 'applied',
        tags: [],
        parentRef: stringField(args ?? {}, 'ref'),
      }
    },
  },
  zotero_create_collection: {
    icon: () => <IconBranchOutlineRegular size={14} />,
    titleKey: 'toolTitleCreateCollection',
    describe: ({ args, t }) => ({
      summary: t('toolSummaryCreateCollection', {
        name: (stringField(args ?? {}, 'name') ?? '').trim(),
      }),
      tone: 'applied',
      tags: [],
      parentRef: stringField(args ?? {}, 'parent'),
    }),
  },
  zotero_delete_collection: {
    icon: () => <IconBranchOutlineRegular size={14} />,
    titleKey: 'toolTitleDeleteCollection',
    describe: ({ args, t }) => {
      const collectionArg = stringField(args ?? {}, 'collection') ?? ''
      return {
        summary: t('toolSummaryDeleteCollection', {
          name: shortKeyOf(collectionArg) ?? collectionArg.trim(),
        }),
        tone: 'applied',
        tags: [],
        parentRef: collectionArg,
      }
    },
  },
  zotero_create_item: {
    icon: () => <IconEditOutlineRegular size={14} />,
    titleKey: 'toolTitleCreateItem',
    describe: ({ args, t }) => ({
      summary: t('toolSummaryCreateItem', {
        title: (stringField(args ?? {}, 'title') ?? stringField(args ?? {}, 'url') ?? '').trim(),
      }),
      tone: 'applied',
      tags: [],
    }),
  },
  zotero_update_item: {
    icon: () => <IconEditOutlineRegular size={14} />,
    titleKey: 'toolTitleUpdateItem',
    describe: ({ args, t }) => {
      const ref = stringField(args ?? {}, 'ref')
      return {
        summary: t('toolSummaryUpdateItem', { ref: shortKeyOf(ref ?? '') ?? (ref ?? '').trim() }),
        tone: 'applied',
        tags: [],
        parentRef: ref,
      }
    },
  },
  zotero_delete_library_tags: {
    // A destructive glyph: this is the irreversible library-wide delete, and
    // the icon must not read like any other edit.
    icon: () => <IconTrashOutlineRegular size={14} />,
    titleKey: 'toolTitleDeleteLibraryTags',
    describe: ({ args, write, t }) => {
      const tags = stringList(args?.['tags'])
      if (write !== null && write.deletedCount !== null) {
        return {
          summary: t('toolSummaryDeleteLibraryTags', { count: write.deletedCount }),
          tone: 'applied',
          tags,
        }
      }
      return {
        summary: t('toolSummaryDeleteLibraryTagsRequested', { count: tags.length }),
        tone: 'unreported',
        tags,
      }
    },
  },
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
    // The runtime types the slot's tool name loosely; registrations pin it to
    // the eight names, and anything unexpected falls back to the create-note
    // arm exactly as the if/else chain's default once did.
    const descriptor =
      WRITE_DESCRIPTORS[toolName as WriteToolName] ?? WRITE_DESCRIPTORS.zotero_create_note
    const args = argsOf(block)
    const raw = (resultTextOf(block) ?? '').trim()
    const meta = metaOf(block)
    const write = meta !== null ? writeMetaOf(meta) : null
    const described = descriptor.describe({ args, write, t })
    const pUrl = described.parentRef ? selectUrlOf(described.parentRef) : null
    return {
      icon: descriptor.icon(),
      title: t(descriptor.titleKey),
      summary: described.summary,
      tone: described.tone,
      errorSummary: errorSummaryOf(block, raw),
      parentRef: described.parentRef,
      parentSelectUrl: pUrl,
      tagsList: described.tags,
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
