/**
 * The `sourcePage` endpoint: the authorized session's trail paged behind the
 * projection's window. One behavior per case — session authorization, the
 * revision fence, the offset continuation, the per-target row cut, and the
 * serving bounds.
 * @module tests/host/source-page
 */

import { describe, expect, it } from 'vitest'
import { Context, Service } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'
import type { Session } from '@deepseek-ai/dsh-session'
import type { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import { blocksOf, emptyLedgerState, foldLedgerEvent } from '../../src/sources/event-ledger.js'
import { readSourcePage } from '../../src/source-page.js'
import { normalizeRefKey } from '../../src/sources/evidence-match.js'
import type { ZoteroRuntime } from '../../src/remote.js'
import ZoteroService from '../../src/index.js'

let seq = 0

/** One committed event as the fold reads it. */
function event(type: string, data: unknown): never {
  seq += 1
  return { type, seq, time: seq * 1000, data } as never
}

const REF_A = 'zotero://user/0/item/AAAA1234'
const SEARCH_META = {
  returned: 1,
  total: 1,
  displayed: 1,
  omitted: 0,
  items: [{ ref: REF_A, title: 'A', creatorSummary: 'Vaswani', year: 2017 }],
}

/** One settled search over one ref. */
function searchEvent(callId: string, ref: string): readonly never[] {
  return [
    event('tool/call', {
      turn: 1,
      step: 1,
      callId,
      name: 'zotero_search',
      arguments: JSON.stringify({ query: 'attention' }),
    }),
    event('tool/result', {
      turn: 1,
      step: 1,
      message: { toolCallId: callId, content: [{ type: 'text', text: 'ok' }] },
      meta: { ...SEARCH_META, items: [{ ...SEARCH_META.items[0], ref }] },
    }),
  ] as never
}

/** A ledger whose workspace carries `count` distinct sources. */
function ledgerWithSources(count: number) {
  let state = emptyLedgerState()
  for (let index = 0; index < count; index++) {
    const suffix = String(index + 1).padStart(4, '0')
    for (const entry of searchEvent(`call-${index}`, `zotero://user/0/item/KEY${suffix}`)) {
      state = foldLedgerEvent(state, entry)
    }
  }
  return state
}

/** A live-Session stand-in: the endpoint reads `id` and `seq` only. */
function sessionStub(id: string, seq: number): Session {
  return { id, seq, header: { id } } as unknown as Session
}

/** The services the endpoint reads at call time, stubbed per case. */
interface LaneOptions {
  readonly allowed: boolean
  readonly state: ReturnType<typeof emptyLedgerState>
  readonly session?: Session
}

function setup(options: LaneOptions): Context {
  const ctx = new Context()
  class StubAccess extends Service {
    constructor(host: Context) {
      super(host, 'remoteAccess')
    }
    allows(): boolean {
      return options.allowed
    }
  }
  new StubAccess(ctx)
  class StubSessions extends Service {
    constructor(host: Context) {
      super(host, 'sessions')
    }
    get(id: string): Session | undefined {
      return options.session?.id === id ? options.session : undefined
    }
  }
  new StubSessions(ctx)
  return ctx
}

/** Boot the plugin and stub the projection handle to serve the given ledger. */
async function boot(ctx: Context, state: ReturnType<typeof emptyLedgerState>): Promise<void> {
  await ctx.plugin(TypertRegistry)
  await ctx.plugin(SystemPrompt, {})
  await ctx.plugin(ToolRuntime, {})
  class StubProjections extends Service {
    constructor(host: Context) {
      super(host, 'sessionProjections')
    }
    async register(): Promise<unknown> {
      return {
        stateOf: () => ({ inheritedEventCount: 0, ledger: state }),
        dispose: async () => {},
      }
    }
  }
  new StubProjections(ctx)
  await ctx.plugin(ZoteroService, { baseUrl: 'http://127.0.0.1:23119/api/' })
}

const SIGNAL = new AbortController().signal

/** The sources-list request at one offset. */
function sourcesRequest(offset?: number, revision?: number) {
  return {
    sessionId: 'session',
    target: { kind: 'sources' as const, filter: 'all' as const },
    ...(offset === undefined ? {} : { offset }),
    ...(revision === undefined ? {} : { revision }),
  }
}

describe('the sourcePage authorization', () => {
  it('refuses a session the caller may not read before reading any state', async () => {
    const state = ledgerWithSources(1)
    const ctx = setup({ allowed: false, state, session: sessionStub('session', 5) })
    await boot(ctx, state)
    const service = ctx.get('zotero') as ZoteroService
    await expect(readSourcePage(ctx, sourcesRequest(), SIGNAL)).rejects.toMatchObject({
      code: 'remote-access/denied',
    })
    await expect(service.sourcePage(sourcesRequest(), SIGNAL)).rejects.toMatchObject({
      code: 'remote-access/denied',
    })
    await ctx.fiber.dispose()
  })

  it('refuses an unknown session after authorization', async () => {
    const state = ledgerWithSources(1)
    const ctx = setup({ allowed: true, state })
    await boot(ctx, state)
    await expect(readSourcePage(ctx, sourcesRequest(), SIGNAL)).rejects.toMatchObject({
      code: 'ZOTERO_NOT_FOUND',
    })
    await ctx.fiber.dispose()
  })
})

describe('the sourcePage revision fence', () => {
  it('answers the first page without a revision and reports the trail watermark', async () => {
    const state = ledgerWithSources(2)
    const ctx = setup({ allowed: true, state, session: sessionStub('session', 3) })
    await boot(ctx, state)
    const page = await readSourcePage(ctx, sourcesRequest(), SIGNAL)
    expect(page.revision).toBe(2)
    expect(page.offset).toBe(0)
    expect(page.total).toBe(2)
    const runtime = ctx.get('zoteroRemote') as ZoteroRuntime
    const runtimePage = await runtime.sourcePage(sourcesRequest(), SIGNAL)
    expect(runtimePage.revision).toBe(2)
    await expect(runtime.openProtocol('invalid-scheme://', SIGNAL)).rejects.toThrow()
    await ctx.fiber.dispose()
  })

  it('refuses a continuation fenced on a moved revision', async () => {
    const state = ledgerWithSources(2)
    const ctx = setup({ allowed: true, state, session: sessionStub('session', 5) })
    await boot(ctx, state)
    await expect(readSourcePage(ctx, sourcesRequest(1, 2), SIGNAL)).rejects.toMatchObject({
      code: 'ZOTERO_SOURCE_PAGE_STALE',
    })
    await ctx.fiber.dispose()
  })

  it('answers a continuation whose revision still matches', async () => {
    const state = ledgerWithSources(2)
    const ctx = setup({ allowed: true, state, session: sessionStub('session', 3) })
    await boot(ctx, state)
    const page = await readSourcePage(ctx, sourcesRequest(1, 2), SIGNAL)
    expect(page.workspace.sources).toHaveLength(1)
    await ctx.fiber.dispose()
  })
})

describe('the sourcePage row cut', () => {
  it('serves the requested slice of the sources list', async () => {
    const state = ledgerWithSources(3)
    const ctx = setup({ allowed: true, state, session: sessionStub('session', 7) })
    await boot(ctx, state)
    const first = await readSourcePage(
      ctx,
      {
        sessionId: 'session',
        target: { kind: 'sources', filter: 'all' },
        limit: 2,
        revision: 6,
      },
      SIGNAL,
    )
    expect(first.workspace.sources).toHaveLength(2)
    expect(first.workspace.sources[0]?.key).toBe('zotero://user/0/item/key0001')
    const second = await readSourcePage(
      ctx,
      {
        sessionId: 'session',
        target: { kind: 'sources', filter: 'all' },
        limit: 2,
        offset: 2,
        revision: 6,
      },
      SIGNAL,
    )
    expect(second.workspace.sources).toHaveLength(1)
    expect(second.workspace.sources[0]?.key).toBe('zotero://user/0/item/key0003')
    await ctx.fiber.dispose()
  })

  it('serves one source row list at one offset', async () => {
    // One source carrying two search episodes: a second query against the
    // same ref starts a new episode, so the second page has rows.
    let state = emptyLedgerState()
    for (const [callId, query] of [
      ['call-a', 'attention'],
      ['call-b', 'transformers'],
    ] as const) {
      state = foldLedgerEvent(
        state,
        event('tool/call', {
          turn: 1,
          step: 1,
          callId,
          name: 'zotero_search',
          arguments: JSON.stringify({ query }),
        }),
      )
      state = foldLedgerEvent(
        state,
        event('tool/result', {
          turn: 1,
          step: 1,
          message: { toolCallId: callId, content: [{ type: 'text', text: 'ok' }] },
          meta: { ...SEARCH_META, items: [{ ...SEARCH_META.items[0]!, ref: REF_A }] },
        }),
      )
    }
    const ctx = setup({ allowed: true, state, session: sessionStub('session', 5) })
    await boot(ctx, state)
    const page = await readSourcePage(
      ctx,
      {
        sessionId: 'session',
        target: { kind: 'source', key: normalizeRefKey(REF_A), rows: 'searches' },
        offset: 1,
        revision: 4,
      },
      SIGNAL,
    )
    expect(page.total).toBe(2)
    expect(page.workspace.sources[0]?.searches).toHaveLength(1)
    await ctx.fiber.dispose()
  })

  it('refuses a source outside the trail', async () => {
    const state = ledgerWithSources(1)
    const ctx = setup({ allowed: true, state, session: sessionStub('session', 3) })
    await boot(ctx, state)
    await expect(
      readSourcePage(
        ctx,
        {
          sessionId: 'session',
          target: { kind: 'source', key: 'MISSING', rows: 'evidence' },
          revision: 2,
        },
        SIGNAL,
      ),
    ).rejects.toMatchObject({ code: 'ZOTERO_NOT_FOUND' })
    await ctx.fiber.dispose()
  })

  it('serves the session exports behind the windowed head', async () => {
    const state = ledgerWithSources(2)
    const ctx = setup({ allowed: true, state, session: sessionStub('session', 5) })
    await boot(ctx, state)
    const page = await readSourcePage(
      ctx,
      {
        sessionId: 'session',
        target: { kind: 'session', rows: 'exports' },
        revision: 4,
      },
      SIGNAL,
    )
    expect(page.offset).toBe(0)
    expect(page.total).toBe(0)
    expect(page.workspace.exports).toHaveLength(0)
    // The page was cut from the whole fold, not the windowed head.
    expect(blocksOf(state)).toHaveLength(2)
    await ctx.fiber.dispose()
  })

  it('refuses an offset past the list end', async () => {
    const state = ledgerWithSources(1)
    const ctx = setup({ allowed: true, state, session: sessionStub('session', 3) })
    await boot(ctx, state)
    await expect(readSourcePage(ctx, sourcesRequest(2, 2), SIGNAL)).rejects.toMatchObject({
      code: 'ZOTERO_INVALID_ARGUMENT',
    })
    await ctx.fiber.dispose()
  })
})

describe('the sourcePage error arm', () => {
  it('reports a denial with the endpoint action and a no-allow reason', async () => {
    const state = ledgerWithSources(1)
    const ctx = setup({ allowed: false, state })
    await boot(ctx, state)
    const failure = await readSourcePage(ctx, sourcesRequest(), SIGNAL).catch(
      (error: unknown) => error,
    )
    expect((failure as RemoteError).details).toEqual({
      action: 'zotero/sourcePage',
      reason: 'no-allow',
    })
    await ctx.fiber.dispose()
  })

  it('refuses when the session closes while the workspace resolves', async () => {
    const state = ledgerWithSources(1)
    const ctx = new Context()
    class StubAccess extends Service {
      constructor(host: Context) {
        super(host, 'remoteAccess')
      }
      allows(): boolean {
        return true
      }
    }
    new StubAccess(ctx)
    let sessionCalls = 0
    const targetSession = sessionStub('session', 3)
    class EphemeralSessions extends Service {
      constructor(host: Context) {
        super(host, 'sessions')
      }
      get(id: string): Session | undefined {
        if (id !== 'session') return undefined
        sessionCalls += 1
        return sessionCalls === 1 ? targetSession : undefined
      }
    }
    new EphemeralSessions(ctx)
    await boot(ctx, state)

    await expect(readSourcePage(ctx, sourcesRequest(0, 2), SIGNAL)).rejects.toMatchObject({
      message: 'The requested session is no longer open.',
      code: 'ZOTERO_NOT_FOUND',
    })
    await ctx.fiber.dispose()
  })
})
