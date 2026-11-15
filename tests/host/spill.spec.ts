import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { ToolExecution } from '@deepseek-ai/dsh-tools'
import type { SaveTextSpill, SpillLocator, SpillRef } from '@deepseek-ai/dsh-spill'
import { exceedsInlineTokenBudget, spilledNoticeOf, trySpillToolOutput } from '../../src/spill.js'

describe('the inline spill boundary', () => {
  it('prices the result with the delivery heuristics and the live budget', () => {
    // A short result fits any realistic budget; a long one outgrows a narrow
    // one, and the same text flips with the budget alone — the threshold is
    // the setting, not a fixed character count.
    const text = 'z'.repeat(20_000)
    expect(exceedsInlineTokenBudget('short', 4_000)).toBe(false)
    expect(exceedsInlineTokenBudget(text, 1_000)).toBe(true)
    expect(exceedsInlineTokenBudget(text, 20_000)).toBe(false)
  })

  it('spells the notice in the persisted spill-policy form with byte counts', () => {
    // The notice names the omitted UTF-8 bytes and the locator in the one
    // spelling every spill-aware consumer recognizes.
    expect(spilledNoticeOf({ locator: 'spill://s/f.txt', retrievalHint: 'Read it.' }, 2048)).toBe(
      '\n\n(Omitted 2048 bytes. Full formatted result stored at: spill://s/f.txt. Read it.)',
    )
  })
})

describe('trySpillToolOutput', () => {
  it('returns undefined when there is no session owner', async () => {
    const ctx = new Context()
    const exec = {
      name: 'zotero_export',
      callId: 'call-1',
      signal: new AbortController().signal,
    } as unknown as ToolExecution

    const result = await trySpillToolOutput(ctx, exec, 'test.txt', 'hello')
    expect(result).toBeUndefined()
  })

  it('returns undefined when no ctx.spillStore is mounted', async () => {
    const ctx = new Context()
    const exec = {
      name: 'zotero_export',
      callId: 'call-1',
      agent: {
        session: {
          header: { id: 'session-123' },
        },
      },
      signal: new AbortController().signal,
    } as unknown as ToolExecution

    const result = await trySpillToolOutput(ctx, exec, 'test.txt', 'hello')
    expect(result).toBeUndefined()
  })

  it('saves text and returns SpillRef when spillStore is present and succeeds', async () => {
    const ctx = new Context()
    const mockRef: SpillRef = {
      locator: 'spill://session-123/test.txt' as SpillLocator,
      bytes: 120,
      retrievalHint: 'Use read_file to view complete results',
    }

    const saveTextMock = vi.fn(async (save: SaveTextSpill) => {
      expect(save.owner.sessionId).toBe('session-123')
      expect(save.suggestedName).toBe('export-bib.bib')
      expect(save.content).toBe('content-data')
      expect(save.source).toEqual({
        kind: 'tool',
        toolName: 'zotero_export',
        callId: 'call-1',
        label: 'result',
      })
      return mockRef
    })

    ctx.provide('spillStore', {
      saveText: saveTextMock,
    } as never)

    const exec = {
      name: 'zotero_export',
      callId: 'call-1',
      agent: {
        session: {
          header: { id: 'session-123' },
        },
      },
      signal: new AbortController().signal,
    } as unknown as ToolExecution

    const result = await trySpillToolOutput(ctx, exec, 'export-bib.bib', 'content-data')
    expect(result).toEqual(mockRef)
    expect(saveTextMock).toHaveBeenCalledOnce()
  })

  it('gracefully degrades and returns undefined when saveText throws', async () => {
    const ctx = new Context()
    const saveTextMock = vi.fn(async () => {
      throw new Error('ENOSPC: disk full')
    })

    ctx.provide('spillStore', {
      saveText: saveTextMock,
    } as never)

    const exec = {
      name: 'zotero_export',
      callId: 'call-1',
      agent: {
        session: {
          header: { id: 'session-123' },
        },
      },
      signal: new AbortController().signal,
    } as unknown as ToolExecution

    const result = await trySpillToolOutput(ctx, exec, 'test.txt', 'hello')
    expect(result).toBeUndefined()
  })
})
