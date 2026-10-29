/**
 * Dedicated toolview cards for Zotero write operations. Renders write
 * receipts, tags, and plan-review decline notices.
 * Each tool is one descriptor (icon, title key, summary builder) in the
 * table below; the receipt body is shared, so adding a write tool means
 * adding one descriptor, not another branch in the body.
 * @module dsh-zotero/client/toolviews/WriteToolView
 */

import { useMemo } from 'react'
import type { ReactNode } from 'react'
import {
  IconBranchOutlineRegular,
  IconEditOutlineRegular,
  IconLinkOutlineRegular,
  IconPlusOutlineRegular,
  IconTrashOutlineRegular,
  Tag,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { ToolArgs } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { CopyButton } from '../components/CopyButton.tsx'
import { launchZoteroProtocol, selectUrlOf } from '../actions/open-zotero.ts'
import { writeMetaOf, type WriteMetaView } from '../sources/write-decoder.ts'
import {
  argsViewOf,
  errorSummaryOf,
  listArg,
  metaOf,
  resultTextOf,
  shortKeyOf,
  textArg,
} from '../presenters.ts'
import { RunningNotice, RawTextFallback, ZoteroToolRow } from './ZoteroToolRow.tsx'
import css from './toolviews.module.css'

/** The write tools this view renders. */
export type WriteToolName =
  | 'zotero_batch_items'
  | 'zotero_create_note'
  | 'zotero_update_note'
  | 'zotero_update_item_tags'
  | 'zotero_update_item_collections'
  | 'zotero_create_collection'
  | 'zotero_update_collection'
  | 'zotero_delete_collection'
  | 'zotero_create_item'
  | 'zotero_update_item'
  | 'zotero_restore_items'
  | 'zotero_create_saved_search'
  | 'zotero_update_saved_search'
  | 'zotero_delete_saved_search'
  | 'scholarly_save_to_zotero'
  | 'zotero_delete_library_tags'

type WriteToolViewProps = PropsRuntime<'tool.call.toolview', WriteToolName> & PropsLocale<'zotero'>

/**
 * What the receipt may claim about the write:
 *
 * - `applied`: the projection reported the applied fact, and it was a change.
 * - `noop`: the projection reported it, and nothing changed.
 * - `unreported`: the projection carried no applied fact at all (a nested
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
type ReceiptTone = 'applied' | 'noop' | 'unreported' | 'partial' | 'failed'

/**
 * The badge each claim wears: the word on it and the tone behind it, paired in
 * one table so a tone cannot be added to one half and forgotten in the other.
 */
const RECEIPT_BADGE = {
  partial: { label: 'badgePartial', tone: 'warning' },
  failed: { label: 'toolFailed', tone: 'danger' },
  applied: { label: 'badgeSuccess', tone: 'success' },
  noop: { label: 'badgeNoOp', tone: 'info' },
  // `unreported` is a warning, not the informational `noop`: nothing was proven
  // either way, which is a weaker position than a proven no-change and must
  // not read like one.
  unreported: { label: 'badgeUnreported', tone: 'warning' },
} as const satisfies Record<
  ReceiptTone,
  {
    readonly label: 'badgeSuccess' | 'badgeNoOp' | 'badgeUnreported' | 'badgePartial' | 'toolFailed'
    readonly tone: 'success' | 'info' | 'warning' | 'danger'
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

/** What one tool's summary builder receives: the call, the projection, and the locale. */
interface DescribeContext {
  readonly args: ToolArgs
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
 * One entry per write tool. Arguments are what the plan card showed the user;
 * a tool whose projection carries a replayable receipt reports that outcome
 * instead, and the rest name only the request they can prove.
 */
const WRITE_DESCRIPTORS: Record<WriteToolName, WriteDescriptor> = {
  zotero_batch_items: {
    icon: () => <IconEditOutlineRegular size={14} />,
    titleKey: 'toolTitleBatchItems',
    describe: ({ args, t }) => {
      // The requested operation counts are what the plan card reviewed; the
      // applied receipt (per-arm counts, unverified entries) rides in the
      // expanded body, so the summary states the request, not the outcome.
      return {
        summary: t('toolSummaryBatchItems', {
          creates: listArg(args, 'create').length,
          updates: listArg(args, 'update').length,
          deletes: listArg(args, 'delete').length,
        }),
        tone: 'applied',
        tags: [],
      }
    },
  },
  zotero_create_note: {
    icon: () => <IconEditOutlineRegular size={14} />,
    titleKey: 'toolTitleCreateNote',
    describe: ({ args, t }) => ({
      summary: t('toolSummaryCreateNote', {
        title: noteTitleOf(textArg(args, 'markdown'), t('toolDefaultNoteTitle')),
      }),
      tone: 'applied',
      tags: listArg(args, 'tags'),
      parentRef: textArg(args, 'parentItem') ?? textArg(args, 'ref'),
    }),
  },
  zotero_update_note: {
    icon: () => <IconEditOutlineRegular size={14} />,
    titleKey: 'toolTitleUpdateNote',
    describe: ({ args, t }) => ({
      summary: t('toolSummaryUpdateNote', {
        title: noteTitleOf(textArg(args, 'markdown'), t('toolDefaultNoteTitle')),
      }),
      tone: 'applied',
      tags: [],
      parentRef: textArg(args, 'ref'),
    }),
  },
  zotero_update_item_tags: {
    icon: () => <IconPlusOutlineRegular size={14} />,
    titleKey: 'toolTitleUpdateItemTags',
    describe: ({ args, write, t }) => {
      const requested = [...listArg(args, 'add'), ...listArg(args, 'remove')]
      if (write === null || (write.addedCount === null && write.removedCount === null)) {
        return {
          summary: t('toolSummaryUpdateItemTagsRequested', { count: requested.length }),
          tone: 'unreported',
          tags: requested,
          parentRef: textArg(args, 'ref'),
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
        parentRef: textArg(args, 'ref'),
      }
    },
  },
  zotero_update_item_collections: {
    icon: () => <IconBranchOutlineRegular size={14} />,
    titleKey: 'toolTitleUpdateItemCollections',
    describe: ({ args, write, t }) => {
      const requested = [...listArg(args, 'add'), ...listArg(args, 'remove')]
      if (write === null || (write.addedCount === null && write.removedCount === null)) {
        const name =
          requested[0] !== undefined ? (shortKeyOf(requested[0]) ?? requested[0].trim()) : ''
        return {
          summary: t('toolSummaryUpdateItemCollectionsRequested', { name }),
          tone: 'unreported',
          tags: [],
          parentRef: textArg(args, 'ref'),
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
        parentRef: textArg(args, 'ref'),
      }
    },
  },
  zotero_create_collection: {
    icon: () => <IconBranchOutlineRegular size={14} />,
    titleKey: 'toolTitleCreateCollection',
    describe: ({ args, t }) => ({
      summary: t('toolSummaryCreateCollection', {
        name: (textArg(args, 'name') ?? '').trim(),
      }),
      tone: 'applied',
      tags: [],
      parentRef: textArg(args, 'parent'),
    }),
  },
  zotero_update_collection: {
    icon: () => <IconBranchOutlineRegular size={14} />,
    titleKey: 'toolTitleUpdateCollection',
    describe: ({ args, t }) => ({
      summary: t('toolSummaryUpdateCollection', {
        name: (textArg(args, 'name') ?? textArg(args, 'collection') ?? '').trim(),
      }),
      tone: 'applied',
      tags: [],
      parentRef: textArg(args, 'collection'),
    }),
  },
  zotero_delete_collection: {
    icon: () => <IconBranchOutlineRegular size={14} />,
    titleKey: 'toolTitleDeleteCollection',
    describe: ({ args, t }) => {
      const collectionArg = textArg(args, 'collection') ?? ''
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
        title: (textArg(args, 'title') ?? textArg(args, 'url') ?? '').trim(),
      }),
      tone: 'applied',
      tags: [],
    }),
  },
  zotero_update_item: {
    icon: () => <IconEditOutlineRegular size={14} />,
    titleKey: 'toolTitleUpdateItem',
    describe: ({ args, t }) => {
      const ref = textArg(args, 'ref')
      return {
        summary: t('toolSummaryUpdateItem', { ref: shortKeyOf(ref ?? '') ?? (ref ?? '').trim() }),
        tone: 'applied',
        tags: [],
        parentRef: ref,
      }
    },
  },
  zotero_restore_items: {
    icon: () => <IconEditOutlineRegular size={14} />,
    titleKey: 'toolTitleRestoreItems',
    describe: ({ args, write, t }) => {
      if (
        write?.kind !== 'restored' ||
        write.restoredCount === null ||
        write.failedCount === null
      ) {
        return {
          summary: t('toolSummaryRestoreItemsRequested', { count: listArg(args, 'refs').length }),
          tone: 'unreported',
          tags: [],
        }
      }
      return {
        summary: t('toolSummaryRestoreItems', {
          restored: write.restoredCount,
          failed: write.failedCount,
        }),
        tone: write.failedCount > 0 ? (write.restoredCount > 0 ? 'partial' : 'failed') : 'applied',
        tags: [],
      }
    },
  },
  zotero_create_saved_search: {
    icon: () => <IconBranchOutlineRegular size={14} />,
    titleKey: 'toolTitleCreateSavedSearch',
    describe: ({ args, t }) => ({
      summary: t('toolSummaryCreateSavedSearch', { name: textArg(args, 'name') ?? '' }),
      tone: 'applied',
      tags: [],
    }),
  },
  zotero_update_saved_search: {
    icon: () => <IconBranchOutlineRegular size={14} />,
    titleKey: 'toolTitleUpdateSavedSearch',
    describe: ({ args, t }) => ({
      summary: t('toolSummaryUpdateSavedSearch', {
        name: textArg(args, 'name') ?? textArg(args, 'search') ?? '',
      }),
      tone: 'applied',
      tags: [],
    }),
  },
  zotero_delete_saved_search: {
    icon: () => <IconTrashOutlineRegular size={14} />,
    titleKey: 'toolTitleDeleteSavedSearch',
    describe: ({ args, t }) => ({
      summary: t('toolSummaryDeleteSavedSearch', { name: textArg(args, 'search') ?? '' }),
      tone: 'applied',
      tags: [],
    }),
  },
  scholarly_save_to_zotero: {
    icon: () => <IconPlusOutlineRegular size={14} />,
    titleKey: 'toolTitleScholarlySave',
    describe: ({ args, t }) => ({
      summary: t('toolSummaryScholarlySave', { title: textArg(args, 'title') ?? '' }),
      tone: 'applied',
      tags: [],
    }),
  },
  zotero_delete_library_tags: {
    // A destructive glyph: this is the irreversible library-wide delete, and
    // the icon must not read like any other edit.
    icon: () => <IconTrashOutlineRegular size={14} />,
    titleKey: 'toolTitleDeleteLibraryTags',
    describe: ({ args, write, t }) => {
      const tags = listArg(args, 'tags')
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
    unknownTool,
  } = useMemo(() => {
    // The runtime types the slot's tool name loosely; the registrations pin it
    // to the declared names, and the membership check keeps an unexpected name
    // from borrowing the create-note receipt, a receipt that would claim a
    // note was created by a tool that is not the note tool.
    const descriptor = (WRITE_DESCRIPTORS as Record<string, WriteDescriptor | undefined>)[toolName]
    if (descriptor === undefined) {
      const raw = (resultTextOf(block) ?? '').trim()
      return {
        icon: null,
        title: '',
        summary: raw.split('\n', 1)[0] ?? '',
        tone: 'unreported' as ReceiptTone,
        errorSummary: errorSummaryOf(block, raw),
        parentRef: null,
        parentSelectUrl: null,
        tagsList: [] as string[],
        rawText: raw,
        unknownTool: true,
      }
    }
    const args = argsViewOf(block)
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
      tagsList: Array.from(new Set(described.tags)),
      rawText: raw,
      unknownTool: false,
    }
  }, [block, t, toolName])

  if (unknownTool) {
    // An unregistered write tool name: no receipt can be honest here, so the
    // card carries only the tool's own text and no borrowed title or badge.
    return (
      <ZoteroToolRow
        toolName={toolName}
        block={block}
        useDisclosure={useDisclosure}
        inspect={inspect}
        t={t}
        icon={null}
        title={toolName}
        summary={summary}
      >
        {() =>
          rawText ? (
            <div className={css.receiptCard}>
              <RawTextFallback text={rawText} />
            </div>
          ) : null
        }
      </ZoteroToolRow>
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
              <Tag className={css.badge} tone="warning">
                {t('toolDeclined')}
              </Tag>
              <div className={css.itemMeta}>{rawText}</div>
            </div>
          )
        }
        if (isUnverified) {
          // The tool's own sentence is the receipt: it names whether the
          // commit itself was unproven, and it carries the do-not-retry
          // instruction. Restating it here would be a second wording of the
          // write boundary's most consequential message, and the collapsed
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
                <Tag className={css.badge} tone="danger">
                  {t('toolFailed')}
                </Tag>
                <span className={css.receiptTitle}>{errorSummary}</span>
              </div>
              {rawText && <RawTextFallback text={rawText} />}
            </div>
          )
        }
        return (
          <div className={css.receiptCard} data-state={tone}>
            <div className={css.itemHeader}>
              <Tag className={css.badge} tone={RECEIPT_BADGE[tone].tone}>
                {t(RECEIPT_BADGE[tone].label)}
              </Tag>
              <span className={css.receiptTitle}>{summary}</span>
            </div>

            {parentRef && (
              <div className={css.itemActions}>
                <span className={css.itemMeta}>{t('toolParentItem')}:</span>
                <button
                  type="button"
                  className={css.actionLink}
                  onClick={() => {
                    const targetUrl = parentSelectUrl ?? selectUrlOf(parentRef)
                    if (targetUrl) void launchZoteroProtocol(targetUrl)
                  }}
                  title={t('openInZoteroTooltip')}
                  aria-label={t('openInZotero')}
                >
                  <IconLinkOutlineRegular size={12} />
                  <span>{parentRef}</span>
                </button>
                <CopyButton
                  value={parentSelectUrl ?? selectUrlOf(parentRef) ?? parentRef}
                  label={t('copyZoteroLink')}
                  copiedLabel={t('copied')}
                  title={t('copyZoteroLinkTooltip')}
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
                    <Tag
                      key={tag}
                      className={css.badge}
                      tone={tone === 'applied' ? 'outline' : RECEIPT_BADGE[tone].tone}
                    >
                      {tag}
                    </Tag>
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
