/**
 * Dedicated toolview cards for browsing and sync:
 * `zotero_browse` and `zotero_changes`.
 * @module dsh-zotero/client/toolviews/BrowseToolView
 */

import { useMemo, type ReactNode } from 'react'
import {
  IconBrowseOutlineRegular,
  IconRefreshOutlineRegular,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime, TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import {
  browseMetaOf,
  changesMetaOf,
  jobArmOf,
  jobSummaryKeyOf,
  type ChangesMetaView,
  type ChangesWithheldReason,
  type JobArmView,
} from '../sources/decoders.ts'
import type { BrowseRow } from '../../browse-rows.ts'
import { countOfLabel } from '../evidence-labels.ts'
import {
  argsViewOf,
  errorSummaryOf,
  metaOf,
  resultTextOf,
  stringField,
  textArg,
} from '../presenters.ts'
import { CopyButton } from '../components/CopyButton.tsx'
import { RawTextFallback, RunningNotice, ZoteroToolRow } from './ZoteroToolRow.tsx'
import css from './toolviews.module.css'

export type BrowseToolViewProps = PropsRuntime<
  'tool.call.toolview',
  'zotero_browse' | 'zotero_changes'
> &
  PropsLocale<'zotero'>

/** The deepest collection nesting the card indents; below it, rows stay flush. */
const MAX_BROWSE_DEPTH = 4

/** One browsed row as the card shows it: a name, an optional count, an optional ref. */
interface BrowseRowView {
  readonly key: string
  readonly name: string
  /** A scoped count, a library id, or a localized label — whatever the row carries. */
  readonly detail: string | null
  readonly ref: string | null
  /** Nesting depth below the top level; 0 for every other browsed kind. */
  readonly depth: number
}

function shortRef(ref: string): string | null {
  return ref === '' ? null : ref
}

/**
 * One browsed row, flattened for display. The classification is
 * `browse-rows.ts`'s — shared with the text the model reads — so this only
 * decides what each arm's name, detail, and ref are.
 */
function browseRowView(row: BrowseRow, index: number): BrowseRowView {
  const key = `${row.kind}-${index}`
  switch (row.kind) {
    case 'library':
      return { key, name: row.name, detail: row.libraryId, ref: null, depth: 0 }
    case 'collection':
      return {
        key,
        // The breadcrumb is the useful line: a nested collection is only
        // identifiable by where it sits, not by its leaf name.
        name: row.breadcrumb.join(' / '),
        detail: null,
        ref: shortRef(row.ref),
        depth: row.depth,
      }
    case 'savedSearch':
      return {
        key,
        name: row.name,
        detail: row.conditionCount === null ? null : String(row.conditionCount),
        ref: shortRef(row.ref),
        depth: 0,
      }
    case 'tag':
      return {
        key,
        name: row.tag,
        detail: row.count === null ? null : String(row.count),
        ref: null,
        depth: 0,
      }
    case 'itemType':
      return { key, name: row.itemType, detail: row.localized, ref: null, depth: 0 }
    case 'field':
      return { key, name: row.field, detail: row.localized, ref: null, depth: 0 }
    case 'creatorType':
      return { key, name: row.creatorType, detail: row.localized, ref: null, depth: 0 }
  }
}

/** The locale key each withheld reason is stated in, and the remedy beside it. */
const WITHHELD_REASON_LABEL = {
  'not-served': 'withheldNotServed',
  'range-not-covered': 'withheldRangeNotCovered',
  unreadable: 'withheldUnreadable',
} as const satisfies Record<
  ChangesWithheldReason['reason'],
  'withheldNotServed' | 'withheldRangeNotCovered' | 'withheldUnreadable'
>

const WITHHELD_REMEDY = {
  'not-served': 'withheldRemedyPermanent',
  'range-not-covered': 'withheldRemedyRebaseline',
  unreadable: 'withheldRemedyRerun',
} as const

/**
 * The diff as the card shows it: the version range it covers, one line per
 * changed kind, one section for the removals, and the cursor to pass back.
 * The cursor is the one value a reader has to copy by hand to continue the
 * diff, so it gets a copy action rather than being text to retype.
 *
 * Everything the tool's own text says about *how far the diff reached* is
 * rendered here too, not just the counts: a diff that withheld its cursor, or
 * that named a kind it could not observe, would otherwise read as a clean
 * "nothing changed" — the one reading `docs/tools.md` explicitly forbids.
 */
function ChangesBody({
  changes,
  t,
}: {
  readonly changes: ChangesMetaView
  readonly t: TranslateNS<'zotero'>
}): ReactNode {
  const cursor = changes.cursor
  const fulltext = changes.changed.find((section) => section.key === 'fulltextAttachments')
  return (
    <>
      {/* The range the diff covers, so every count below is bounded by a
          statement about what was compared rather than about the library. */}
      {changes.fromVersion !== null && (
        <div className={css.itemMeta} data-changes-range>
          {t('toolChangesRange', {
            from: changes.fromVersion,
            to: cursor?.version ?? t('toolChangesRangeUnknown'),
          })}
        </div>
      )}

      <div className={css.cardList} data-changes-sections>
        {changes.changed.map((section) => (
          <div key={section.key} className={css.itemCard} data-changes-kind={section.key}>
            <div className={css.itemHeader}>
              <span className={css.itemTitle}>{t(section.label)}</span>
              <span className={css.badge}>
                {countOfLabel(section.total, section.entries.length, t)}
              </span>
            </div>
            {section.entries.map((entry) => (
              <div key={entry.key} className={css.itemMeta} data-changes-entry>
                <span>{entry.key}</span>
                <span className={css.badge}>v{entry.version}</span>
              </div>
            ))}
            {/* A full-text row's number comes from the index's own counter, not
                from the library version the range above describes. */}
            {section === fulltext && (
              <div className={css.itemMeta} data-changes-caveat>
                {t('toolChangesFulltextCaveat')}
              </div>
            )}
          </div>
        ))}
      </div>

      {changes.deleted.length > 0 && (
        <div className={css.notesSection} data-changes-deleted>
          <span className={css.sectionTitle}>
            {changes.deletedTotal === null
              ? t('toolDeletedNone')
              : t('toolDeletedTitle', { count: changes.deletedTotal })}
          </span>
          <div className={css.cardList}>
            {changes.deleted.map((section) => (
              <div key={section.key} className={css.itemCard} data-changes-kind={section.key}>
                <div className={css.itemHeader}>
                  <span className={css.itemTitle}>{t(section.label)}</span>
                  <span className={css.badge}>
                    {countOfLabel(section.total, section.keys.length, t)}
                  </span>
                </div>
                {section.keys.map((key) => (
                  <div key={key} className={css.itemMeta} data-changes-entry>
                    <span>{key}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* What this diff could not see. Absent a listing is not "nothing
          changed", so the kinds the read could not cover are named, with the
          reason, before the cursor — whose absence this section explains. */}
      {changes.withheld !== null && (
        <div className={css.notesSection} data-changes-withheld>
          <span className={css.sectionTitle}>{t('toolChangesWithheld')}</span>
          {changes.withheld.map((entry) => (
            <div key={`${entry.kind}-${entry.reason}`} className={css.itemMeta}>
              {t('availabilityEntry', {
                source: `${entry.kind}: ${t(WITHHELD_REASON_LABEL[entry.reason])}`,
                detail: t(WITHHELD_REMEDY[entry.reason]),
              })}
            </div>
          ))}
        </div>
      )}

      {cursor !== null ? (
        <div className={css.notesSection} data-changes-cursor>
          <span className={css.sectionTitle}>{t('toolChangesCursor')}</span>
          <div className={css.itemHeader}>
            <span className={css.itemMeta}>
              {t('toolChangesCursorValue', { version: cursor.version, serverId: cursor.serverId })}
            </span>
            <CopyButton
              value={JSON.stringify({
                version: cursor.version,
                serverId: cursor.serverId,
              })}
              label={t('copy')}
              copiedLabel={t('copied')}
              className={css.lineAction}
            />
          </div>
        </div>
      ) : (
        <div className={css.coverageNotice} data-changes-no-cursor>
          {t('toolChangesNoCursor')}
        </div>
      )}
    </>
  )
}

export function BrowseToolView(props: BrowseToolViewProps) {
  const { toolName, block, useDisclosure, inspect, t } = props

  const isChanges = toolName === 'zotero_changes'
  const title = isChanges ? t('toolTitleChanges') : t('toolTitleBrowse')

  const { icon, summary, errorSummary, rows, empty, nextOffset, changes, job, rawText } =
    useMemo(() => {
      const raw = (resultTextOf(block) ?? '').trim()
      const errSummary = errorSummaryOf(block, raw)
      const args = argsViewOf(block)
      // The kind the call asked for is the only label available before the
      // result lands, and the fallback when a malformed replay record leaves the
      // projection without one. It is the tool's required parameter — the old
      // `category` fallback named a parameter the tool has never had.
      const askedKind = textArg(args, 'kind')
      const meta = metaOf(block)

      let sum = ''
      let rowViews: BrowseRowView[] = []
      // A page the projection reports as empty is a finding, not a gap: the card
      // says so instead of printing the bare `kind: 0 of 0` header as a code box.
      let empty = false
      let next: number | null = null
      let changesView: ChangesMetaView | null = null
      let job: JobArmView | null = null

      if ('phase' in block && block.phase === 'start') {
        sum = t('toolRunning')
      } else if (isChanges) {
        // A long diff is handed to a background job rather than answered inline.
        // Read that arm first: the job id is the one value the reader needs to
        // collect the result, and the diff shape below would render an empty
        // page and report no changes.
        job = meta !== null ? jobArmOf(meta) : null
        if (job === null) {
          const changes = meta !== null ? changesMetaOf(meta) : null
          changesView = changes
          // Removals are not changes: counting the `deleted*` totals into the
          // changed total reported more changes than the library had, and a diff
          // that deleted two of four changed items read as six.
          sum =
            changes?.changedTotal != null
              ? t('toolSummaryChanges', { count: changes.changedTotal })
              : t('toolTitleChanges')
        } else {
          sum = t(jobSummaryKeyOf(job), { jobId: job.jobId })
        }
      } else {
        const browse = meta !== null ? browseMetaOf(meta) : null
        const kind = browse?.kind ?? askedKind
        // The page facts come from the projection, never from counting text
        // lines: the rendered listing is one header line, two lines per library
        // row, and a closing page pointer, so a line count is never an item
        // count.
        if (browse !== null && browse.returned !== null && browse.total !== null) {
          sum = t('toolSummaryBrowsePage', {
            kind: kind ?? t('toolTitleBrowse'),
            returned: browse.returned,
            total: browse.total,
          })
        } else if (kind !== undefined) {
          sum = t('toolSummaryBrowseKind', { kind })
        } else {
          sum = t('toolTitleBrowse')
        }
        rowViews = (browse?.rows ?? []).map(browseRowView)
        empty = browse?.rows != null && browse.rows.length === 0
        next = browse?.nextOffset ?? null
      }

      return {
        // The icon rides the memo with everything else the header renders, so a
        // re-render that leaves the call's own facts alone reuses the same node
        // and the `DisclosureRow` above it can skip the work.
        icon: isChanges ? (
          <IconRefreshOutlineRegular size={14} />
        ) : (
          <IconBrowseOutlineRegular size={14} />
        ),
        summary: sum,
        errorSummary: errSummary,
        rows: rowViews,
        empty,
        nextOffset: next,
        changes: changesView,
        job,
        rawText: raw,
      }
    }, [block, isChanges, t])

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
      {({ isRunning }) => {
        if (isRunning) {
          return <RunningNotice text={t('toolRunning')} />
        }
        if (isChanges) {
          if (changes !== null && (changes.changed.length > 0 || changes.deleted.length > 0)) {
            return <ChangesBody changes={changes} t={t} />
          }
          if (job !== null) {
            // The diff is still running. Its own text says where it is; the
            // card has no partial answer to draw, and an empty "no results"
            // notice would read as a diff that found nothing.
            return (
              <div className={css.coverageNotice} data-job-arm={job.kind}>
                {rawText || t('toolSummaryJobPending')}
              </div>
            )
          }
          return rawText ? (
            <RawTextFallback text={rawText} />
          ) : (
            <div className={css.coverageNotice}>{t('toolNoResults')}</div>
          )
        }
        if (rows.length === 0) {
          // A page the projection reports as empty is a finding, not a gap.
          if (empty) {
            return <div className={css.coverageNotice}>{t('toolNoResults')}</div>
          }
          // The rows are unavailable — an over-budget projection, an absent
          // meta, or a malformed record — so the tool's own text is all there is.
          return rawText ? (
            <RawTextFallback text={rawText} />
          ) : (
            <div className={css.coverageNotice}>{t('toolNoResults')}</div>
          )
        }
        return (
          <>
            <div className={css.cardList}>
              {rows.map((row) => (
                <div
                  key={row.key}
                  className={css.itemCard}
                  data-browse-row={row.key}
                  data-depth={row.depth > 0 ? Math.min(row.depth, MAX_BROWSE_DEPTH) : undefined}
                >
                  <div className={css.itemHeader}>
                    <span className={css.itemTitle}>{row.name}</span>
                    {row.detail !== null && <span className={css.badge}>{row.detail}</span>}
                  </div>
                  {row.ref !== null && <div className={css.itemMeta}>{row.ref}</div>}
                </div>
              ))}
            </div>
            {nextOffset !== null && (
              <div className={css.coverageNotice}>
                {t('toolBrowseNextPage', { offset: nextOffset })}
              </div>
            )}
          </>
        )
      }}
    </ZoteroToolRow>
  )
}
