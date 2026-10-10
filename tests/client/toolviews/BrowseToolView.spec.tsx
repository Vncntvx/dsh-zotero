// @vitest-environment jsdom
/**
 * Test suite for BrowseToolView:
 * browse views, changes views, empty/running states, and error handling.
 * @module tests/client/toolviews/BrowseToolView
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { zh } from '../../../src/client/locales.ts'
import { BrowseToolView } from '../../../src/client/toolviews/BrowseToolView.tsx'
import { mockT } from '../helpers/mock-translate.ts'
import { createToolViewProps, mockUseDisclosure } from '../helpers/mock-disclosure.ts'
import { running, settled } from '../helpers/blocks.ts'
import { writeClipboardSpy } from '../helpers/primitives-stub.ts'

vi.mock('@deepseek-ai/dsh-client-ui-primitives', async () => {
  const { primitivesStub } = await import('../helpers/primitives-stub.ts')
  return primitivesStub()
})

const writeClipboard = await writeClipboardSpy()

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function renderBrowseView(
  props: Parameters<typeof createToolViewProps<'zotero_browse' | 'zotero_changes'>>[0],
) {
  return render(<BrowseToolView {...createToolViewProps(props)} />)
}

/**
 * One settled `zotero_browse` call, built the way the tool builds it: the
 * arguments the schema accepts and the record its `presentationMeta` emits.
 * The listing *text* is the tool's own business (`tests/unit/browse-rows`
 * pins that shape, and a host tool module has no place in this lane's
 * program), so this helper takes the text as the caller saw it.
 */
function browseCall(options: {
  readonly kind: string
  readonly items: readonly unknown[]
  readonly text?: string
  readonly total?: number
  readonly nextOffset?: number
}) {
  const { kind, items, text, total = items.length, nextOffset } = options
  return settled({
    call: { name: 'zotero_browse', argsRaw: JSON.stringify({ kind, offset: 0, limit: 20 }) },
    meta: {
      kind,
      total,
      offset: 0,
      returned: items.length,
      items,
      ...(nextOffset === undefined ? {} : { nextOffset }),
    },
    content: text === undefined ? [] : [{ type: 'text', text }],
  })
}

function viewBrowse(block: ReturnType<typeof settled>) {
  return renderBrowseView({
    callId: 'c1',
    toolName: 'zotero_browse',
    phase: 'result',
    block,
    useDisclosure: mockUseDisclosure(true),
    t: mockT,
  })
}

describe('BrowseToolView (zotero_browse & zotero_changes)', () => {
  it('reads the browsed kind from the projection, never from a category argument', () => {
    viewBrowse(
      browseCall({
        kind: 'collections',
        items: [
          {
            ref: 'zotero://user/0/collection/AAAA1111',
            name: 'Reading',
            path: ['Reading'],
            depth: 0,
          },
          {
            ref: 'zotero://user/0/collection/BBBB2222',
            name: '2026',
            path: ['Reading', '2026'],
            depth: 1,
          },
        ],
      }),
    )

    expect(
      screen.getByText(
        mockT('toolSummaryBrowsePage', { kind: 'collections', returned: 2, total: 2 }),
      ),
    ).toBeTruthy()
    expect(screen.getByText('Reading / 2026')).toBeTruthy()
    // The old caption interpolated a `category` the tool has never had, so
    // every browse row read "Browse items".
    expect(screen.queryByText(/items/)).toBeNull()
  })

  it('counts a page from the projection, not from the listing text lines', () => {
    // A libraries page renders one header line, two lines per row, and a page
    // pointer: 42 lines for 20 rows. Counting lines reported 42 items.
    const block = browseCall({
      kind: 'libraries',
      text: `libraries: 20 of 20\n${Array.from(
        { length: 20 },
        (_, index) => `${index + 1}. Library ${index} — user/${index}\n   library=user/${index}`,
      ).join('\n')}\nMore: browse again with offset 20`,
      total: 20,
      nextOffset: 20,
      items: Array.from({ length: 20 }, (_, index) => ({
        library: { type: 'user', id: index },
        name: `Library ${index}`,
      })),
    })
    expect((block.content[0] as { text: string }).text.split('\n').length).toBe(42)

    viewBrowse(block)

    expect(
      screen.getByText(
        mockT('toolSummaryBrowsePage', { kind: 'libraries', returned: 20, total: 20 }),
      ),
    ).toBeTruthy()
    expect(screen.getByText(mockT('toolBrowseNextPage', { offset: 20 }))).toBeTruthy()
  })

  it('renders every browsed arm with the facts its own row carries', () => {
    // The card switches on the arm the shared classifier named, so a row shape
    // with no case would silently draw nothing. Each arm is named here, and the
    // three that carry a `localized` label are checked for that badge.
    const { container } = viewBrowse(
      browseCall({
        kind: 'libraries',
        items: [
          { library: { type: 'user', id: 0 }, name: 'My Library' },
          {
            ref: 'zotero://user/0/collection/AAAA1111',
            name: 'Reading',
            path: ['Reading'],
            depth: 0,
          },
          { tag: 'quantum', count: 12 },
          { itemType: 'journalArticle', localized: 'Journal Article' },
          { field: 'archive', localized: 'Archive' },
          { creatorType: 'author', localized: 'Author' },
          { ref: 'zotero://user/0/savedSearch/SS123456', name: 'Unread', conditions: [{}] },
        ],
      }),
    )

    expect(
      Array.from(container.querySelectorAll('[data-browse-row]')).map((row) =>
        row.getAttribute('data-browse-row'),
      ),
    ).toEqual([
      'library-0',
      'collection-1',
      'tag-2',
      'itemType-3',
      'field-4',
      'creatorType-5',
      'savedSearch-6',
    ])
    expect(screen.getByText('My Library')).toBeTruthy()
    expect(screen.getByText('user/0')).toBeTruthy()
    expect(screen.getByText('Reading')).toBeTruthy()
    expect(screen.getByText('zotero://user/0/collection/AAAA1111')).toBeTruthy()
    expect(screen.getByText('quantum')).toBeTruthy()
    expect(screen.getByText('12')).toBeTruthy()
    expect(screen.getByText('journalArticle')).toBeTruthy()
    expect(screen.getByText('author')).toBeTruthy()
    expect(screen.getByText('Unread')).toBeTruthy()
    // Each `localized` label rides beside its own row.
    expect(screen.getByText('Journal Article')).toBeTruthy()
    expect(screen.getByText('Archive')).toBeTruthy()
    expect(screen.getByText('Author')).toBeTruthy()
  })

  it('renders a tag row with its scoped count', () => {
    viewBrowse(
      browseCall({
        kind: 'tags',
        items: [{ tag: 'quantum', count: 12 }, { tag: 'bibliography' }],
      }),
    )
    expect(screen.getByText('quantum')).toBeTruthy()
    expect(screen.getByText('12')).toBeTruthy()
    // A whole-library tag list carries no count, and the card invents none.
    expect(screen.getByText('bibliography')).toBeTruthy()
  })

  it('indents a nested collection to its depth and clamps a deep one', () => {
    const { container } = viewBrowse(
      browseCall({
        kind: 'collections',
        items: [
          { ref: 'r0', name: 'Root', path: ['Root'], depth: 0 },
          { ref: 'r1', name: 'One', path: ['Root', 'One'], depth: 1 },
          { ref: 'r9', name: 'Deep', path: ['Root', 'Deep'], depth: 9 },
        ],
      }),
    )
    const depths = Array.from(container.querySelectorAll('[data-browse-row]')).map((card) =>
      card.getAttribute('data-depth'),
    )
    expect(depths).toEqual([null, '1', '4'])
  })

  it('falls back to the tool text when the byte budget dropped the rows', () => {
    // `boundedPresentationMeta` drops `items` and keeps the page facts, so a
    // heavy page still reads its count exactly and shows the listing as text.
    const block = settled({
      call: { name: 'zotero_browse', argsRaw: JSON.stringify({ kind: 'collections' }) },
      meta: { kind: 'collections', total: 900, offset: 0, returned: 20, detailOmitted: true },
      content: [{ type: 'text', text: 'collections: 20 of 900' }],
    })
    const { container } = viewBrowse(block)

    expect(
      screen.getByText(
        mockT('toolSummaryBrowsePage', { kind: 'collections', returned: 20, total: 900 }),
      ),
    ).toBeTruthy()
    expect(screen.getByText(mockT('detailOmittedNote'))).toBeTruthy()
    expect(container.querySelector('pre')?.textContent).toBe('collections: 20 of 900')
  })

  it('labels the kind it asked for when the projection carries no page facts', () => {
    const block = settled({
      call: { name: 'zotero_browse', argsRaw: JSON.stringify({ kind: 'savedSearches' }) },
      content: [{ type: 'text', text: 'Unread' }],
    })
    viewBrowse(block)
    expect(
      screen.getAllByText(mockT('toolSummaryBrowseKind', { kind: 'savedSearches' })).length,
    ).toBeGreaterThanOrEqual(1)
  })

  it('counts only what changed, never the removals alongside it', () => {
    // Four objects changed and two were deleted. The summary said six, which
    // is more changes than the library had.
    const block = settled({
      call: {
        name: 'zotero_changes',
        argsRaw: JSON.stringify({ since: { version: 10, serverId: 'abc' } }),
      },
      meta: {
        fromVersion: 10,
        cursor: { version: 20, serverId: 'abc' },
        changed: {
          items: [
            { key: 'AAAA1111', version: 11 },
            { key: 'BBBB2222', version: 12 },
          ],
        },
        deleted: { items: ['CCCC3333', 'DDDD4444'], collections: [], savedSearches: [], tags: [] },
        totals: { items: 4, deletedItems: 2 },
      },
      content: [{ type: 'text', text: 'Changes 10 → 20' }],
    })

    const { container } = renderBrowseView({
      callId: 'c1',
      toolName: 'zotero_changes',
      phase: 'result',
      block,
      useDisclosure: mockUseDisclosure(true),
      t: mockT,
    })

    expect(screen.getByText(mockT('toolSummaryChanges', { count: 4 }))).toBeTruthy()
    // The removals get their own section, counted on their own.
    expect(screen.getByText(mockT('toolDeletedTitle', { count: 2 }))).toBeTruthy()
    expect(container.querySelector('[data-changes-deleted]')).toBeTruthy()
  })

  it('lists each changed kind with its keys and versions, and offers the cursor to copy', () => {
    const block = settled({
      call: {
        name: 'zotero_changes',
        argsRaw: JSON.stringify({ since: { version: 10, serverId: 'abc' } }),
      },
      meta: {
        fromVersion: 10,
        cursor: { version: 20, serverId: 'abc' },
        changed: {
          items: [{ key: 'AAAA1111', version: 11 }],
          collections: [{ key: 'COLL1111', version: 12 }],
        },
        totals: { items: 1, collections: 1 },
      },
      content: [{ type: 'text', text: 'Changes 10 → 20' }],
    })

    const { container } = renderBrowseView({
      callId: 'c1',
      toolName: 'zotero_changes',
      phase: 'result',
      block,
      useDisclosure: mockUseDisclosure(true),
      t: mockT,
    })

    expect(
      Array.from(container.querySelectorAll('[data-changes-kind]')).map((s) =>
        s.getAttribute('data-changes-kind'),
      ),
    ).toEqual(['items', 'collections'])
    expect(screen.getByText('AAAA1111')).toBeTruthy()
    expect(screen.getByText('v11')).toBeTruthy()
    expect(
      screen.getByText(mockT('toolChangesCursorValue', { version: 20, serverId: 'abc' })),
    ).toBeTruthy()

    // The cursor is what a reader has to hand back as `since`; it gets a copy
    // action rather than being text to retype.
    fireEvent.click(screen.getAllByLabelText(zh.copy)[0]!)
    expect(writeClipboard).toHaveBeenCalledWith(JSON.stringify({ version: 20, serverId: 'abc' }))
  })

  it('says a capped listing how many keys it left out', () => {
    const block = settled({
      call: {
        name: 'zotero_changes',
        argsRaw: JSON.stringify({ since: { version: 10, serverId: 'abc' } }),
      },
      meta: {
        fromVersion: 10,
        changed: { items: [{ key: 'AAAA1111', version: 11 }] },
        totals: { items: 500 },
      },
      content: [{ type: 'text', text: 'Changes 10 → 20' }],
    })

    renderBrowseView({
      callId: 'c1',
      toolName: 'zotero_changes',
      phase: 'result',
      block,
      useDisclosure: mockUseDisclosure(true),
      t: mockT,
    })

    expect(screen.getByText(mockT('countOfReturned', { total: 500, shown: 1 }))).toBeTruthy()
  })

  it('names the removals it cannot list individually', () => {
    // `totals.deletedOther` counts tombstones of kinds this tool does not
    // report one by one; the card states them rather than quietly undercounting
    // the removals beside the count.
    const block = settled({
      call: {
        name: 'zotero_changes',
        argsRaw: JSON.stringify({ since: { version: 10, serverId: 'abc' } }),
      },
      meta: {
        fromVersion: 10,
        changed: {},
        deleted: { items: [], collections: [], savedSearches: [], tags: [] },
        totals: { deletedOther: 4 },
      },
      content: [{ type: 'text', text: 'Other deleted objects: 4' }],
    })

    const { container } = renderBrowseView({
      callId: 'c1',
      toolName: 'zotero_changes',
      phase: 'result',
      block,
      useDisclosure: mockUseDisclosure(true),
      t: mockT,
    })

    expect(screen.getByText(mockT('toolDeletedTitle', { count: 4 }))).toBeTruthy()
    // The four reported tombstone families render empty; the unlistable bucket
    // is the one carrying the count.
    expect(
      Array.from(container.querySelectorAll('[data-changes-deleted] [data-changes-kind]')).map(
        (s) => s.getAttribute('data-changes-kind'),
      ),
    ).toEqual(['items', 'collections', 'savedSearches', 'tags', 'other'])
    expect(container.querySelector('[data-changes-kind="other"]')?.textContent).toContain(
      zh.toolDeletedOther,
    )
  })

  it('states the range it covers, so a count is never read as a whole-library one', () => {
    const block = settled({
      call: {
        name: 'zotero_changes',
        argsRaw: JSON.stringify({ since: { version: 10, serverId: 'abc' } }),
      },
      meta: {
        fromVersion: 10,
        cursor: { version: 20, serverId: 'abc' },
        changed: { items: [{ key: 'AAAA1111', version: 11 }] },
        totals: { items: 1 },
      },
      content: [{ type: 'text', text: 'Changes 10 → 20' }],
    })

    const { container } = renderBrowseView({
      callId: 'c1',
      toolName: 'zotero_changes',
      phase: 'result',
      block,
      useDisclosure: mockUseDisclosure(true),
      t: mockT,
    })

    expect(container.querySelector('[data-changes-range]')?.textContent).toBe(
      mockT('toolChangesRange', { from: 10, to: 20 }),
    )
  })

  it('says a diff withheld its cursor rather than reading as a clean one', () => {
    // A missing cursor is a fact about the range, not about the library. A card
    // that simply omits the cursor block would leave a reader concluding the
    // diff succeeded and settled.
    const block = settled({
      call: {
        name: 'zotero_changes',
        argsRaw: JSON.stringify({ since: { version: 10, serverId: 'abc' } }),
      },
      meta: {
        fromVersion: 10,
        changed: { items: [{ key: 'AAAA1111', version: 11 }] },
        libraryChanged: true,
        totals: { items: 1 },
      },
      content: [{ type: 'text', text: 'Changes 10 → version not advanced' }],
    })

    const { container } = renderBrowseView({
      callId: 'c1',
      toolName: 'zotero_changes',
      phase: 'result',
      block,
      useDisclosure: mockUseDisclosure(true),
      t: mockT,
    })

    expect(container.querySelector('[data-changes-no-cursor]')?.textContent).toBe(
      mockT('toolChangesNoCursor'),
    )
    expect(container.querySelector('[data-changes-cursor]')).toBeNull()
  })

  it('names the kinds this diff could not observe, with the remedy for each', () => {
    // `docs/tools.md`: never read an absent listing as "nothing changed" before
    // checking what was unobservable. The card is where a reader checks.
    const block = settled({
      call: { name: 'zotero_changes', argsRaw: JSON.stringify({ since: { version: 10 } }) },
      meta: {
        fromVersion: 10,
        changed: { items: [{ key: 'AAAA1111', version: 11 }] },
        totals: { items: 1 },
        unobservable: [
          { kind: 'collections', reason: 'not-served' },
          { kind: 'fulltextAttachments', reason: 'range-not-covered' },
          { kind: 'savedSearches', reason: 'unreadable' },
        ],
      },
      content: [{ type: 'text', text: 'Not served by this Zotero build: collections' }],
    })

    const { container } = renderBrowseView({
      callId: 'c1',
      toolName: 'zotero_changes',
      phase: 'result',
      block,
      useDisclosure: mockUseDisclosure(true),
      t: mockT,
    })

    const withheld = container.querySelector('[data-changes-withheld]')
    expect(withheld?.textContent).toContain('collections')
    expect(withheld?.textContent).toContain('fulltextAttachments')
    expect(withheld?.textContent).toContain('savedSearches')
    // Each reason carries the remedy the tool's own text gives it.
    expect(withheld?.textContent).toContain(zh.withheldRemedyPermanent)
    expect(withheld?.textContent).toContain(zh.withheldRemedyRebaseline)
    expect(withheld?.textContent).toContain(zh.withheldRemedyRerun)
  })

  it('marks a full-text section as the index counter it counts on', () => {
    // A full-text row's number comes from the index's own counter, not the
    // library version the range above describes; presenting it as a library
    // change count is the misleading part.
    const block = settled({
      call: { name: 'zotero_changes', argsRaw: JSON.stringify({ since: { version: 10 } }) },
      meta: {
        fromVersion: 10,
        changed: { fulltextAttachments: [{ key: 'WXYZ6789', version: 900 }] },
        totals: { fulltextAttachments: 1 },
      },
      content: [{ type: 'text', text: 'Full-text reindexed: 1 changed' }],
    })

    const { container } = renderBrowseView({
      callId: 'c1',
      toolName: 'zotero_changes',
      phase: 'result',
      block,
      useDisclosure: mockUseDisclosure(true),
      t: mockT,
    })

    expect(
      container.querySelector('[data-changes-kind="fulltextAttachments"] [data-changes-caveat]')
        ?.textContent,
    ).toBe(mockT('toolChangesFulltextCaveat'))
  })

  it('names the job a long diff was handed to, instead of an empty diff', () => {
    // `zotero_changes` can be promoted to a background job. The diff shape has
    // nothing to draw in that case, so reading it as a diff would show an empty
    // page and report no changes: the opposite of "still running".
    for (const kind of ['background', 'promoted'] as const) {
      const block = settled({
        call: { name: 'zotero_changes', argsRaw: JSON.stringify({ since: { version: 10 } }) },
        meta: { kind, jobId: 'job-7' },
        content: [{ type: 'text', text: `Zotero changes: ${kind} job job-7` }],
      })

      const { container, unmount } = renderBrowseView({
        callId: 'c1',
        toolName: 'zotero_changes',
        phase: 'result',
        block,
        useDisclosure: mockUseDisclosure(true),
        t: mockT,
      })

      expect(
        screen.getAllByText(
          mockT(kind === 'background' ? 'toolSummaryJobBackground' : 'toolSummaryJobPromoted', {
            jobId: 'job-7',
          }),
        ).length,
      ).toBeGreaterThanOrEqual(1)
      expect(container.querySelector('[data-job-arm]')?.getAttribute('data-job-arm')).toBe(kind)
      // No change count is claimed: nothing has been compared yet.
      expect(screen.queryByText(mockT('toolSummaryChanges', { count: 0 }))).toBeNull()
      unmount()
    }
  })

  it('renders zotero_changes with changes summary and output', () => {
    const block = settled({
      call: {
        name: 'zotero_changes',
        argsRaw: JSON.stringify({ since: 10 }),
      },
      content: [{ type: 'text', text: 'Change 1: version 11' }],
    })

    renderBrowseView({
      callId: 'c1',
      toolName: 'zotero_changes',
      phase: 'result',
      block,
      useDisclosure: mockUseDisclosure(true),
      t: mockT,
    })

    expect(screen.getAllByText(zh.toolTitleChanges).length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('Change 1: version 11')).toBeTruthy()
  })

  it('renders zotero_changes with meta totals using toolSummaryChanges', () => {
    const block = settled({
      call: {
        name: 'zotero_changes',
        argsRaw: JSON.stringify({ since: 10 }),
      },
      meta: {
        totals: {
          items: 4,
          collections: 2,
        },
      },
      content: [{ type: 'text', text: 'Change details...' }],
    })

    renderBrowseView({
      callId: 'c1',
      toolName: 'zotero_changes',
      phase: 'result',
      block,
      useDisclosure: mockUseDisclosure(true),
      t: mockT,
    })

    expect(screen.getByText(mockT('toolSummaryChanges', { count: 6 }))).toBeTruthy()
  })

  it('renders running state for browse operations', () => {
    const block = running({
      name: 'zotero_browse',
      argsRaw: JSON.stringify({ kind: 'collections' }),
    })

    renderBrowseView({
      callId: 'c1',
      toolName: 'zotero_browse',
      phase: 'start',
      block,
      useDisclosure: mockUseDisclosure(false),
      t: mockT,
    })

    expect(screen.getAllByText(zh.toolTitleBrowse).length).toBeGreaterThanOrEqual(1)
  })

  it('renders running state with toolRunning in body when expanded', () => {
    const block = running({
      name: 'zotero_browse',
      argsRaw: JSON.stringify({ kind: 'collections' }),
    })

    renderBrowseView({
      callId: 'c1',
      toolName: 'zotero_browse',
      phase: 'start',
      block,
      useDisclosure: mockUseDisclosure(true),
      t: mockT,
    })

    expect(screen.getAllByText(zh.toolRunning).length).toBe(2)
  })

  it('renders zotero_browse empty results notice when the page returned nothing', () => {
    viewBrowse(browseCall({ kind: 'tags', items: [], total: 0 }))

    expect(screen.getByText(zh.toolNoResults)).toBeTruthy()
    expect(
      screen.getByText(mockT('toolSummaryBrowsePage', { kind: 'tags', returned: 0, total: 0 })),
    ).toBeTruthy()
  })

  it('renders zotero_browse error state with message and fallback', () => {
    const blockWithError = settled({
      call: {
        name: 'zotero_browse',
        argsRaw: JSON.stringify({ kind: 'collections' }),
      },
      isError: true,
      content: [{ type: 'text', text: 'unsupported browse kind' }],
    })

    renderBrowseView({
      callId: 'c1',
      toolName: 'zotero_browse',
      phase: 'result',
      block: blockWithError,
      useDisclosure: mockUseDisclosure(true),
      t: mockT,
    })

    expect(screen.getAllByText('unsupported browse kind').length).toBeGreaterThanOrEqual(1)

    cleanup()

    const blockEmptyError = settled({
      call: {
        name: 'zotero_browse',
        argsRaw: JSON.stringify({ kind: 'collections' }),
      },
      isError: true,
      content: [],
    })

    renderBrowseView({
      callId: 'c2',
      toolName: 'zotero_browse',
      phase: 'result',
      block: blockEmptyError,
      useDisclosure: mockUseDisclosure(true),
      t: mockT,
    })

    expect(screen.getAllByText(zh.toolFailed).length).toBeGreaterThanOrEqual(1)
  })

  it('handles malformed argsRaw in browse where argsOf returns null', () => {
    const block = settled({
      call: {
        name: 'zotero_browse',
        argsRaw: '{bad-json',
      },
      content: [{ type: 'text', text: 'Row 1' }],
    })

    const { container } = viewBrowse(block)

    expect(screen.getAllByText(zh.toolTitleBrowse).length).toBeGreaterThanOrEqual(1)
    expect(container.querySelector('pre')?.textContent).toBe('Row 1')
  })
})
