import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { ToolExecution } from '@deepseek-ai/dsh-tools'
import type { SaveTextSpill, SpillLocator, SpillRef } from '@deepseek-ai/dsh-spill'
import { trySpillToolOutput, DEFAULT_SPILL_CHAR_THRESHOLD } from '../../src/spill.js'

describe('trySpillToolOutput', () => {
  it('has DEFAULT_SPILL_CHAR_THRESHOLD set to 16,000', () => {
    expect(DEFAULT_SPILL_CHAR_THRESHOLD).toBe(16_000)
  })

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
