/**
 * The `zotero_changes` tool surface: baseline readings and minted cursors,
 * diffs over items, child objects, trash, and deletions, group libraries,
 * unobservable kinds, and the render of every digest and withheld cursor.
 * @module tests/tools/changes
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cursorLibraryMismatchMessage } from '../../src/local/changes-cursor.js'
import {
  BASELINE_CURSOR_REUSE,
  baselineCursorMessage,
  CHANGES_INCLUDE_EMPTY_MESSAGE,
  CHANGES_NO_DELETIONS_MESSAGE,
  UNOBSERVABLE_RANGE_NOT_COVERED_MESSAGE,
} from '../../src/tools/changes.js'
import { PERSONAL_LIBRARY_MESSAGE } from '../../src/tools/validate.js'
import { expectValue, type HostLane, setupHostLane } from '../helpers/lanes/host-lane.js'

let lane: HostLane
let mock: HostLane['mock']
let runTool: HostLane['runTool']

beforeEach(async () => {
  lane = await setupHostLane()
  mock = lane.mock
  runTool = lane.runTool
})

afterEach(async () => {
  await lane.teardown()
})

describe('zotero_changes tool', () => {
  /**
   * Serve the two item endpoints beside `/items/top` as empty listings at
   * `version`: the item kind reads all three, so a diff over items needs them
   * even when only the top-level listing carries rows.
   */
  const routeEmptySides = (version: string, prefix = '/api/users/0', serverId = 'S1'): void => {
    for (const path of [`${prefix}/items`, `${prefix}/items/trash`]) {
      mock.route('GET', path, (req, res, helpers) =>
        helpers.json(
          {},
          {
            'Total-Results': '0',
            'Last-Modified-Version': version,
            'Zotero-Server-ID': serverId,
          },
        ),
      )
    }
  }

  it('registers and exposes its schema to the assembly', () => {
    expect(lane.tool('zotero_changes')).toBeDefined()
    expect(lane.ctx.tools.schemas().some((schema) => schema.name === 'zotero_changes')).toBe(true)
  })

  it('takes a baseline reading end to end and mints the cursor', async () => {
    mock.route('GET', '/api/users/0/items/top', (req, res, helpers, search) => {
      expect(search.get('limit')).toBe('1')
      helpers.json([], { 'Last-Modified-Version': '42', 'Zotero-Server-ID': 'S1' })
    })
    const result = expectValue(await runTool('zotero_changes', {}), 'zotero_changes')
    const value = result.value as {
      cursor?: { serverId: string; library: unknown; version: number }
      changed: Record<string, unknown>
    }
    expect(value.cursor).toEqual({
      serverId: 'S1',
      library: { type: 'user', id: 0 },
      version: 42,
      include: ['items', 'collections', 'savedSearches', 'deleted'],
      unserved: [],
    })
    expect(value.changed).toEqual({})
    const text = (result.content[0] as { text: string }).text
    expect(text).toContain(baselineCursorMessage(42, 'S1'))
    expect(text).toContain(BASELINE_CURSOR_REUSE)
  })

  it('round-trips the minted cursor through a diff and carries the claim', async () => {
    let probes = 0
    mock.route('GET', '/api/users/0/items/top', (req, res, helpers, search) => {
      if (search.get('limit') === '1') {
        probes += 1
        // The baseline reads the library as it was (42); by the time the diff
        // probes, it has advanced to 50.
        helpers.json([], {
          'Last-Modified-Version': probes === 1 ? '42' : '50',
          'Zotero-Server-ID': 'S1',
        })
        return
      }
      expect(search.get('since')).toBe('42')
      helpers.json({ ABCD1234: 44 }, { 'Total-Results': '1', 'Last-Modified-Version': '50' })
    })
    const baseline = expectValue(await runTool('zotero_changes', {}), 'zotero_changes')
    const cursor = (baseline.value as { cursor: unknown }).cursor
    routeEmptySides('50')
    mock.requests.length = 0
    const diff = expectValue(
      await runTool('zotero_changes', { since: cursor, include: ['items'] }),
      'zotero_changes',
    )
    const value = diff.value as { fromVersion?: number; cursor?: { version: number } }
    expect(value.fromVersion).toBe(42)
    expect(value.cursor?.version).toBe(50)
    // The cursor's instance travels on every request of the diff, so a server
    // that is no longer that instance refuses it.
    for (const request of mock.requests) {
      expect(request.headers['zotero-server-id']).toBe('S1')
    }
  })

  it('refuses a cursor this plugin would diff against the wrong counter', async () => {
    const cursor = { serverId: 'S1', library: { type: 'user', id: 0 }, version: 42, unserved: [] }
    // A version is a counter of one library, so a cursor from user/0 says
    // nothing about group/42; the mix-up is refused before any read.
    const crossLibrary = await runTool('zotero_changes', {
      library: { type: 'group', id: 42 },
      since: cursor,
    })
    expect(crossLibrary.isError).toBe(true)
    if (!crossLibrary.isError) throw new Error('unreachable')
    expect((crossLibrary.content[0] as { text: string }).text).toContain(
      cursorLibraryMismatchMessage('user/0', 'group/42'),
    )
    // The schema owns the shape; the constraints it cannot express fail here.
    for (const since of [
      { ...cursor, serverId: '  ' },
      { ...cursor, version: -1 },
      { ...cursor, library: { type: 'user', id: 5 } },
    ]) {
      const result = await runTool('zotero_changes', { since, include: ['items'] })
      expect(result.isError).toBe(true)
      expect(mock.requests).toHaveLength(0)
    }
  })

  it('diffs from a cursor and renders every section, child objects included', async () => {
    const bodies: Record<string, Record<string, number>> = {
      '/api/users/0/items/top': { ABCD1234: 44 },
      '/api/users/0/items': { ABCD1234: 44, NOTE1234: 45 },
      '/api/users/0/items/trash': { TRSH1234: 46 },
    }
    mock.route('GET', '/api/users/0/items/top', (req, res, helpers, search) => {
      // The pre-read version probe and the items diff share this path.
      if (search.get('limit') === '1') {
        helpers.json([], { 'Last-Modified-Version': '50', 'Zotero-Server-ID': 'S1' })
        return
      }
      expect(search.get('since')).toBe('42')
      expect(search.get('format')).toBe('versions')
      helpers.json(bodies['/api/users/0/items/top']!, {
        'Total-Results': '1',
        'Last-Modified-Version': '50',
      })
    })
    for (const path of ['/api/users/0/items', '/api/users/0/items/trash']) {
      mock.route('GET', path, (req, res, helpers) =>
        helpers.json(bodies[path]!, {
          'Total-Results': String(Object.keys(bodies[path]!).length),
          'Last-Modified-Version': '50',
        }),
      )
    }
    mock.route('GET', '/api/users/0/deleted', (req, res, helpers, search) => {
      expect(search.get('since')).toBe('42')
      helpers.json({ items: ['EEEE0001'], collections: [], searches: [], tags: ['obsolete'] })
    })
    const result = expectValue(
      await runTool('zotero_changes', {
        since: { serverId: 'S1', library: { type: 'user', id: 0 }, version: 42, unserved: [] },
        include: ['items', 'deleted'],
      }),
      'zotero_changes',
    )
    const value = result.value as {
      fromVersion?: number
      cursor?: { version: number }
      changed: { items?: unknown[]; childItems?: unknown[]; trashedItems?: unknown[] }
      deleted?: { items?: string[]; tags?: string[] }
      totals?: { items?: number; childItems?: number; deletedItems?: number }
    }
    expect(value.fromVersion).toBe(42)
    expect(value.cursor?.version).toBe(50)
    expect(value.changed.childItems).toEqual([{ key: 'NOTE1234', version: 45 }])
    expect(value.changed.trashedItems).toEqual([{ key: 'TRSH1234', version: 46 }])
    expect(value.totals?.childItems).toBe(1)
    expect(value.deleted?.items).toEqual(['EEEE0001'])
    expect(value.deleted?.tags).toEqual(['obsolete'])
    expect(value.totals?.items).toBe(1)
    expect(value.totals?.deletedItems).toBe(1)
    const text = (result.content[0] as { text: string }).text
    expect(text).toContain('Changes 42 → 50')
    expect(text).toContain('- ABCD1234 (v44)')
    expect(text).toContain('Items (top-level): 1 changed')
    expect(text).toContain('Child objects (notes, attachments, annotations): 1 changed')
    expect(text).toContain('- NOTE1234 (v45)')
    expect(text).toContain('Items in the trash: 1 changed')
    expect(text).toContain('Deleted items: 1')
    expect(text).toContain('Deleted tags: 1')
  })

  it('diffs a group library through its own prefix and pins the cursor to it', async () => {
    mock.route('GET', '/api/groups/42/items/top', (req, res, helpers, search) => {
      if (search.get('limit') === '1') {
        helpers.json([], { 'Last-Modified-Version': '9', 'Zotero-Server-ID': 'S2' })
        return
      }
      helpers.json({ ABCD1234: 7 }, { 'Total-Results': '1', 'Last-Modified-Version': '9' })
    })
    routeEmptySides('9', '/api/groups/42', 'S2')
    const result = expectValue(
      await runTool('zotero_changes', {
        library: { type: 'group', id: 42 },
        since: { serverId: 'S2', library: { type: 'group', id: 42 }, version: 3, unserved: [] },
        include: ['items'],
      }),
      'zotero_changes',
    )
    const value = result.value as {
      library?: { type: string; id: number }
      cursor?: { serverId: string; library: { type: string; id: number }; version: number }
    }
    expect(value.library).toEqual({ type: 'group', id: 42 })
    expect(value.cursor).toEqual({
      serverId: 'S2',
      library: { type: 'group', id: 42 },
      version: 9,
      include: ['items'],
      unserved: [],
    })
  })

  it('diffs the default resource set without the full-text listing', async () => {
    // The fulltext endpoint answers in the index's own version counter, so a
    // plain diff must not read it: a 404 there would surface as `unobservable`.
    mock.route('GET', '/api/users/0/items/top', (req, res, helpers, search) => {
      if (search.get('limit') === '1') {
        helpers.json([], { 'Last-Modified-Version': '50', 'Zotero-Server-ID': 'S1' })
        return
      }
      helpers.json({ ABCD1234: 44 }, { 'Total-Results': '1', 'Last-Modified-Version': '50' })
    })
    routeEmptySides('50')
    for (const path of ['/api/users/0/collections', '/api/users/0/searches']) {
      mock.route('GET', path, (req, res, helpers) =>
        helpers.json({}, { 'Total-Results': '0', 'Last-Modified-Version': '50' }),
      )
    }
    mock.route('GET', '/api/users/0/deleted', (req, res, helpers) =>
      helpers.json({ items: [], collections: [], searches: [], tags: [] }),
    )
    const result = expectValue(
      await runTool('zotero_changes', {
        since: { serverId: 'S1', library: { type: 'user', id: 0 }, version: 42, unserved: [] },
      }),
      'zotero_changes',
    )
    const value = result.value as {
      unobservable?: unknown[]
      deleted?: { items: string[]; tags: string[] }
      changed: { fulltextAttachments?: unknown }
      cursor?: { version: number }
    }
    expect(value.changed.fulltextAttachments).toBeUndefined()
    // Every kind the diff did read was served, so nothing is named unobservable.
    expect(value.unobservable).toBeUndefined()
    // An empty tombstone read is a finding, not a gap: the lists are present.
    expect(value.deleted).toEqual({ items: [], collections: [], savedSearches: [], tags: [] })
    expect(value.cursor?.version).toBe(50)
    expect(mock.requests.some((request) => request.pathname.endsWith('/fulltext'))).toBe(false)
    const text = (result.content[0] as { text: string }).text
    expect(text).toContain(CHANGES_NO_DELETIONS_MESSAGE)
  })

  it('names an unserved kind and an older-than-history range apart in the render', async () => {
    mock.route('GET', '/api/users/0/items/top', (req, res, helpers, search) => {
      if (search.get('limit') === '1') {
        helpers.json([], { 'Last-Modified-Version': '50', 'Zotero-Server-ID': 'S1' })
        return
      }
      helpers.json({}, { 'Total-Results': '0', 'Last-Modified-Version': '50' })
    })
    routeEmptySides('50')
    mock.route('GET', '/api/users/0/deleted', (req, res, helpers) =>
      helpers.raw(409, { 'Content-Type': 'text/plain' }, 'Conflict'),
    )
    const result = expectValue(
      await runTool('zotero_changes', {
        since: { serverId: 'S1', library: { type: 'user', id: 0 }, version: 42, unserved: [] },
        include: ['items', 'deleted'],
      }),
      'zotero_changes',
    )
    const value = result.value as { unobservable?: unknown[]; deleted?: unknown }
    expect(value.deleted).toBeUndefined()
    expect(value.unobservable).toEqual([{ kind: 'deleted', reason: 'range-not-covered' }])
    const text = (result.content[0] as { text: string }).text
    expect(text).toContain(UNOBSERVABLE_RANGE_NOT_COVERED_MESSAGE)
    expect(text).toContain('deleted')
  })

  it('rejects an invalid library shape before any request', async () => {
    const result = await runTool('zotero_changes', {
      library: { type: 'user', id: 5 },
    })
    expect(result.isError).toBe(true)
    if (!result.isError) throw new Error('unreachable')
    expect((result.content[0] as { text: string }).text).toContain(PERSONAL_LIBRARY_MESSAGE)
    expect(mock.requests).toEqual([])
  })

  it('rejects an explicit empty include before any request', async () => {
    const result = await runTool('zotero_changes', {
      since: { serverId: 'S1', library: { type: 'user', id: 0 }, version: 42, unserved: [] },
      include: [],
    })
    expect(result.isError).toBe(true)
    if (!result.isError) throw new Error('unreachable')
    expect((result.content[0] as { text: string }).text).toContain(CHANGES_INCLUDE_EMPTY_MESSAGE)
    expect(mock.requests).toEqual([])
  })

  it('rejects a cursor whose own include list cannot describe its coverage', async () => {
    // The cursor's include is carried back verbatim, so an empty or duplicated
    // list is a cursor this plugin could never have issued; accepting it would
    // invent a coverage claim the caller did not make.
    for (const include of [[], ['items', 'items']]) {
      const result = await runTool('zotero_changes', {
        since: {
          serverId: 'S1',
          library: { type: 'user', id: 0 },
          version: 42,
          include,
          unserved: [],
        },
      })
      expect(result.isError).toBe(true)
      if (!result.isError) throw new Error('unreachable')
      expect((result.content[0] as { text: string }).text).toContain(
        'since.include must list the resource kinds covered by the cursor',
      )
    }
    expect(mock.requests).toEqual([])
  })

  it('rejects a cursor that calls a covered kind unserved', async () => {
    const result = await runTool('zotero_changes', {
      since: {
        serverId: 'S1',
        library: { type: 'user', id: 0 },
        version: 42,
        include: ['items'],
        unserved: ['items'],
      },
    })
    expect(result.isError).toBe(true)
    if (!result.isError) throw new Error('unreachable')
    expect((result.content[0] as { text: string }).text).toContain(
      'since.unserved must list resource kinds the cursor could not observe',
    )
    expect(mock.requests).toEqual([])
  })
})
