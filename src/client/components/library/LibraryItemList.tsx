import { ContentButton } from '../ContentButton.tsx'
import { memo, useEffect, useRef, useState } from 'react'
import { useLibraryPreferences, useLibraryScroll } from '../../library-preferences.tsx'
import preferenceCss from '../../library-settings.module.css'
/**
 * The library panel's item list: one page of the current scope's hits, the
 * scope's live name in the header, and the offset paginator under the rows.
 * Selecting a row hands its ref to the inspector.
 * @module dsh-zotero/client/components/library/LibraryItemList
 */

import clsx from 'clsx'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { UseContextMenu } from '@deepseek-ai/dsh-client-ui-context-menu/client'
import type { InputActions } from '@deepseek-ai/dsh-client-ui-conversation/client'
import {
  Button,
  IconWorkspaceTreeOutlineMedium,
  Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { IconButton } from '../IconButton.tsx'
import { formatCreatorsList } from '../../../creators.ts'
import { isPdfContentType } from '../../../media-types.ts'
import type { ZoteroSearchItemView } from '../../../contract.ts'
import { joinNonEmpty } from '../../../sources/presenters.ts'
import type { ParsedArtifactReader } from '../../enrichment/ParsePdfAction.tsx'
import type { ParsedDocuments } from '../../parsed-documents.ts'
import { pageRangeOf, type LibraryListState, type LibrarySelection } from './library-model.ts'
import { itemTypeLabelOf, type ItemTypeLocalizedNames } from './item-type-labels.ts'
import { LibraryPager } from './LibraryPager.tsx'
import css from './library.module.css'
import { laneTextOf } from './library-errors.ts'
import { JournalMetricsSummary } from './JournalMetrics.tsx'
import type { useJournalMetrics } from './useJournalMetrics.ts'

interface ParsedArtifactProbeFace {
  readonly sessionId: string
  readonly read?: ParsedArtifactReader
  readonly revision?: number
  /** Commit/discard invalidation from the parsed-document provider. */
  readonly documents?: ParsedDocuments
}

interface LibraryItemChat {
  readonly inputActions: InputActions
  readonly signal: AbortSignal
}

interface LibraryItemListProps {
  readonly scrollKey?: string
  readonly returnToLibrary?: () => void
  readonly filtered?: boolean
  /** Reveals the current scope's row in the collection tree; absent for fixed scopes. */
  readonly locate?: () => void
  readonly locateError?: string
  readonly t: TranslateNS<'zotero'>
  readonly list: LibraryListState
  readonly selection: LibrarySelection
  readonly offset: number
  readonly gotoOffset: (offset: number) => void
  readonly selectedRef: string | undefined
  readonly selectItem: (ref: string | undefined) => void
  readonly retry: () => void
  readonly useContextMenu?: UseContextMenu
  readonly chat?: LibraryItemChat
  readonly parsedArtifact?: ParsedArtifactProbeFace
  /** Zotero's own localized item-type names, for types the plugin table lacks. */
  readonly localizedItemTypes?: ItemTypeLocalizedNames
  readonly journalMetrics?: ReturnType<typeof useJournalMetrics>
}

/**
 * The row's creator line: the structured authors when Zotero reported them,
 * else its own summary. The summary is opaque and locale-formatted upstream
 * (a Chinese Zotero joins two names with a conjunction and no spaces), so the
 * structured names are the display source whenever they exist.
 */
function creatorsOf(item: ZoteroSearchItemView): string {
  if (item.authors !== undefined && item.authors.length > 0) {
    return formatCreatorsList(item.authors.map((name) => ({ name })))
  }
  return item.creatorSummary
}

function insertItemQuote(
  chat: LibraryItemChat,
  item: ZoteroSearchItemView,
  creators: string,
  venue: string | undefined,
): boolean {
  if (chat.signal.aborted) return false
  const title = item.title.trim()
  const origin = joinNonEmpty(item.year, venue)
  const text = [title, creators, origin, item.doi && `DOI: ${item.doi}`, item.ref]
    .filter(Boolean)
    .join('\n')
  const label = title || item.ref
  if (
    !chat.inputActions.insertQuote(text, {
      label,
      title: label,
      detail: origin || undefined,
      body: creators,
    })
  )
    return false
  chat.inputActions.persistDraft()
  return true
}

/**
 * Probes which visible items have an already-parsed Markdown artifact: one
 * batched freshness probe per page, invalidated by the parse dialog's
 * revision and by every commit or discard the parsed-document provider
 * reports — never by polling.
 */
export function useParsedArtifacts(
  items: readonly ZoteroSearchItemView[] | undefined,
  parsedArtifact?: ParsedArtifactProbeFace,
): ReadonlySet<string> {
  const [parsedRefs, setParsedRefs] = useState<ReadonlySet<string>>(() => new Set())
  const [probeEpoch, setProbeEpoch] = useState(0)
  const cacheRef = useRef<Map<string, boolean>>(new Map())
  const prevRevision = useRef<number | undefined>(parsedArtifact?.revision)
  const prevProbeRevision = useRef(0)
  const documents = parsedArtifact?.documents
  const read = parsedArtifact?.read
  const sessionId = parsedArtifact?.sessionId
  const revision = parsedArtifact?.revision

  useEffect(() => {
    if (documents === undefined) return
    return documents.probeRevision.subscribe(() => setProbeEpoch((epoch) => epoch + 1))
  }, [documents])

  useEffect(() => {
    const probeRevision = documents?.probeRevision.getSnapshot() ?? 0
    if (prevRevision.current !== revision || prevProbeRevision.current !== probeRevision) {
      cacheRef.current.clear()
      prevRevision.current = revision
      prevProbeRevision.current = probeRevision
    }

    if (read === undefined || sessionId === undefined || !items || items.length === 0) {
      setParsedRefs(new Set())
      return
    }

    const cache = cacheRef.current

    const candidates = items
      .filter((item) => isPdfContentType(item.bestAttachmentType) && item.bestAttachmentRef)
      .map((item) => item.bestAttachmentRef!)

    if (candidates.length === 0) {
      setParsedRefs(new Set())
      return
    }

    const knownParsed = new Set<string>()
    const unknown: string[] = []

    for (const ref of candidates) {
      const cached = cache.get(ref)
      if (cached === true) {
        knownParsed.add(ref)
      } else if (cached === undefined) {
        unknown.push(ref)
      }
    }

    setParsedRefs(knownParsed)

    const uniqueUnknown = [...new Set(unknown)]
    if (uniqueUnknown.length === 0) {
      return
    }

    const abort = new AbortController()

    void read({ sessionId, op: 'probe', refs: uniqueUnknown }, abort.signal)
      .then((result) => {
        if (abort.signal.aborted) return
        const probed = result.ok && result.value.kind === 'probed' ? result.value : undefined
        if (probed === undefined) return
        for (const { ref, state } of probed.results) cache.set(ref, state === 'ready')
        setParsedRefs((prev) => {
          const next = new Set(prev)
          for (const { ref, state } of probed.results) {
            if (state === 'ready') next.add(ref)
          }
          return next
        })
      })
      .catch(() => {
        // A failed probe stays unknown: the next revision or page turn retries.
      })

    return () => {
      abort.abort()
    }
  }, [items, sessionId, read, revision, documents?.probeRevision, probeEpoch])

  return parsedRefs
}

/** The header a selection shows; collection/search rows carry their own name. */
function selectionLabelOf(selection: LibrarySelection, t: TranslateNS<'zotero'>): string {
  switch (selection.kind) {
    case 'library':
      return t('libraryAllItems')
    case 'publications':
      return t('libraryPublications')
    case 'trash':
      return t('libraryTrash')
    case 'collection':
      return selection.path?.join(' / ') || selection.name
    case 'savedSearch':
      return selection.name
  }
}

export const LibraryItemList = memo(function LibraryItemList(props: LibraryItemListProps) {
  return props.useContextMenu === undefined ? (
    <LibraryItemListBody {...props} />
  ) : (
    <LibraryItemListWithContextMenu {...props} useContextMenu={props.useContextMenu} />
  )
})

function LibraryItemListWithContextMenu(
  props: LibraryItemListProps & {
    readonly useContextMenu: NonNullable<LibraryItemListProps['useContextMenu']>
  },
) {
  const contextMenu = props.useContextMenu()
  return <LibraryItemListBody {...props} contextMenu={contextMenu} />
}

function LibraryItemListBody({
  t,
  scrollKey = 'list',
  filtered,
  returnToLibrary,
  locate,
  locateError,
  list,
  selection,
  offset,
  gotoOffset,
  selectedRef,
  selectItem,
  retry,
  contextMenu,
  chat,
  parsedArtifact,
  localizedItemTypes,
  journalMetrics,
}: Omit<LibraryItemListProps, 'useContextMenu'> & {
  readonly contextMenu?: ReturnType<NonNullable<LibraryItemListProps['useContextMenu']>>
}) {
  const scroll = useLibraryScroll(scrollKey, list.phase === 'ready')
  const { preferences } = useLibraryPreferences()
  const compact = preferences?.listDensity === 'compact'
  const range = list.phase === 'ready' ? pageRangeOf(list, list.items.length) : undefined
  const parsedRefs = useParsedArtifacts(
    list.phase === 'ready' ? list.items : undefined,
    parsedArtifact,
  )

  return (
    <section
      className={css.list}
      aria-busy={list.phase === 'loading'}
      aria-label={t('libraryItemList')}
    >
      <header className={css.listHeader}>
        <h2 className={css.listTitle}>{selectionLabelOf(selection, t)}</h2>
        <div className={css.listHeaderMeta}>
          {list.phase === 'ready' && range !== undefined && (
            <span className={css.listCount}>
              {t('libraryRangeOfTotal', { start: range.start, end: range.end, total: range.total })}
            </span>
          )}
          {locate !== undefined && (
            <Tooltip label={t('libraryLocate')} side="bottom" delayMs={500} portal>
              <IconButton
                shape="square"
                icon={<IconWorkspaceTreeOutlineMedium className={css.actionIcon} />}
                aria-label={t('libraryLocate')}
                onClick={locate}
              />
            </Tooltip>
          )}
        </div>
      </header>

      {locate !== undefined && locateError !== undefined && (
        <p role="alert" className={clsx(css.treeError, css.listLocateError)}>
          {laneTextOf(locateError, t)}
        </p>
      )}

      <div className={css.listScrollArea} {...scroll}>
        {list.phase === 'loading' && (
          <p className={css.listNote} role="status">
            {t('libraryLoading')}
          </p>
        )}

        {list.phase === 'error' && (
          <div role="alert" className={css.listErrorWrap}>
            <p className={css.listError}>{laneTextOf(list.message, t)}</p>
            <Button variant="outline" size="sm" onClick={retry}>
              {t('libraryRetry')}
            </Button>
            {'ref' in selection && returnToLibrary && (
              <Button variant="outline" size="sm" onClick={returnToLibrary}>
                {t('libraryAllItems')}
              </Button>
            )}
          </div>
        )}

        {list.phase === 'ready' && list.items.length === 0 && (
          <p className={css.listNote}>{t(filtered ? 'libraryNoMatches' : 'libraryEmptyList')}</p>
        )}

        {list.phase === 'ready' && list.items.length > 0 && (
          <ul className={css.listRows}>
            {list.items.map((item) => {
              const isSelected = selectedRef === item.ref
              const hasPdf = isPdfContentType(item.bestAttachmentType)
              const isParsed =
                hasPdf &&
                item.bestAttachmentRef !== undefined &&
                parsedRefs.has(item.bestAttachmentRef)
              const creators = creatorsOf(item)
              const venue = item.venue || item.publicationTitle || undefined
              const triggerProps = contextMenu?.getTriggerProps({
                kind: 'zoteroItem',
                value: {
                  ref: item.ref,
                  title: item.title,
                  itemType: item.itemType,
                  ...(chat && {
                    addToChat: () => insertItemQuote(chat, item, creators, venue),
                  }),
                },
              })
              return (
                <li
                  key={item.ref}
                  className={clsx(css.itemSeat, isSelected && css.itemSeatSelected)}
                >
                  <ContentButton
                    size={compact ? 'sm' : 'md'}
                    variant="ghost"
                    {...triggerProps}
                    className={css.itemRow}
                    aria-current={isSelected || undefined}
                    onClick={() => selectItem(isSelected ? undefined : item.ref)}
                  >
                    <span
                      className={clsx(
                        css.itemRowContent,
                        compact && css.itemRowContentCompact,
                        hasPdf && css.itemRowContentHasPdf,
                      )}
                    >
                      <span
                        className={clsx(
                          preferenceCss.rowTitle,
                          preferences?.titleLines === 1
                            ? preferenceCss.oneLine
                            : preferenceCss.twoLines,
                        )}
                        title={item.title}
                      >
                        {item.title || item.ref}
                      </span>
                      <span className={css.itemMeta}>
                        {item.year !== undefined && (
                          <span className={css.itemYear}>{item.year}</span>
                        )}
                        <span className={css.itemType}>
                          {itemTypeLabelOf(item.itemType, localizedItemTypes, t)}
                        </span>
                        {(venue !== undefined || creators !== '') && (
                          <span className={css.itemByline}>
                            {venue !== undefined && (
                              <span className={css.itemVenue} title={venue}>
                                {venue}
                              </span>
                            )}
                            {creators !== '' && (
                              <span className={css.itemCreator} title={creators}>
                                {creators}
                              </span>
                            )}
                          </span>
                        )}
                      </span>
                      {journalMetrics && item.publicationTitle && preferences && (
                        <JournalMetricsSummary
                          t={t}
                          order={preferences.journalMetricListOrder}
                          compact={compact}
                          result={journalMetrics.forJournal(item.publicationTitle)}
                        />
                      )}
                    </span>
                    {/* A detection badge, not an absence claim: the search
                     * index's best-attachment pick names a PDF when one is
                     * indexed; rows without it may still carry files. */}
                    {hasPdf && !isParsed && (
                      <span className={css.pdfBadge} title={t('badgePdfTitle')}>
                        {t('badgePdf')}
                      </span>
                    )}
                    {hasPdf && isParsed && (
                      <div className={css.badgeStack}>
                        <span className={css.pdfBadge} title={t('badgePdfTitle')}>
                          {t('badgePdf')}
                        </span>
                        <span className={css.mdBadge} title={t('badgePdfMarkdownTitle')}>
                          {t('badgeMarkdown')}
                        </span>
                      </div>
                    )}
                  </ContentButton>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      {list.phase === 'ready' && (list.items.length > 0 || offset > 0) && (
        <footer>
          <LibraryPager
            t={t}
            label={t('libraryItemList')}
            offset={offset}
            limit={list.limit}
            total={list.total}
            returned={list.items.length}
            nextOffset={list.nextOffset}
            onPage={gotoOffset}
            // The header count already carries the range line.
            showRange={false}
          />
        </footer>
      )}
    </section>
  )
}
