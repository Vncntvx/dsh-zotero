/**
 * `/zotero` command-input projection: the non-command Chat node that
 * activates a fresh Conversation shell so a status run on a blank session is
 * visible (ordinary `command` rows alone keep the Hero). The generic command
 * Definition still owns the result row.
 * @module tests/client/zotero-command-input
 */

// @vitest-environment jsdom
import { cleanup, render, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import { ZoteroCommandInputView } from '../../src/client/ZoteroCommandInputView.tsx'
import {
  zoteroCommandInputDefinition,
  zoteroCommandText,
} from '../../src/client/zotero-command-input.ts'
import { zh } from '../../src/client/locales.ts'
import { makeTranslate } from './helpers/mock-translate.ts'

afterEach(cleanup)

function runEvent(data: Record<string, unknown>): SessionEvent<'command/run'> {
  return {
    type: 'command/run',
    seq: 1,
    time: 1_700_000_000_000,
    data: { commandId: 'command-zotero', source: { kind: 'user' }, ...data },
  } as SessionEvent<'command/run'>
}

describe('zotero command-input projection', () => {
  it('matches only /zotero runs and derives the visible command line', () => {
    const zotero = runEvent({ name: 'zotero', args: ' status' })
    const plan = runEvent({ name: 'plan', args: '' })

    expect(zoteroCommandInputDefinition.match(zotero)).toEqual({
      id: 'command-zotero',
      role: 'start',
    })
    expect(zoteroCommandInputDefinition.match(plan)).toBeNull()
    // Production `command/run.args` is the harness rawInput slice after `/zotero`,
    // so it keeps the separating whitespace (`' status'`).
    expect(zoteroCommandText(zotero)).toBe('/zotero status')
    expect(zoteroCommandText(runEvent({ name: 'zotero', args: ' status  ' }))).toBe(
      '/zotero status',
    )
    // A trimmed or missing args still renders one space, never `/zoterostatus`.
    expect(zoteroCommandText(runEvent({ name: 'zotero', args: 'status' }))).toBe('/zotero status')
    expect(zoteroCommandText(runEvent({ name: 'zotero', args: '   ' }))).toBe('/zotero')
    expect(zoteroCommandText(runEvent({ name: 'zotero' }))).toBe('/zotero')
    expect(zoteroCommandText(runEvent({ name: 'zotero', args: '' }))).toBe('/zotero')
  })

  it('builds a visible non-command Chat node before the generic result row', () => {
    const match = {
      event: runEvent({ name: 'zotero', args: ' status' }),
      role: 'start' as const,
      location: { kind: 'session' as const },
    }
    const state = zoteroCommandInputDefinition.start({} as never, match, {} as never)
    expect(state).toMatchObject({
      commandId: 'command-zotero',
      text: '/zotero status',
      seq: 1,
    })
    expect(zoteroCommandInputDefinition.update({ state } as never, match)).toBe(state)

    const node = zoteroCommandInputDefinition.buildViewNode!({
      key: 'zotero-command-input',
      id: 'command-zotero',
      state,
      start: match,
    } as never)
    // kind !== 'command' is the shell's activation edge (ui-chat `isActive`).
    expect(node).toMatchObject({
      kind: 'zotero-command-input',
      anchorSeq: 0.9,
      visibility: 'visible',
      data: { commandId: 'command-zotero', text: '/zotero status' },
    })
    expect(zoteroCommandInputDefinition.buildViewNode!({ state: undefined } as never)).toBeNull()
  })

  it('falls back to an unresolved location when the start edge carries none', () => {
    const match = {
      event: runEvent({ name: 'zotero', args: ' status' }),
      role: 'start' as const,
    }
    const state = zoteroCommandInputDefinition.start({} as never, match as never, {} as never)
    const withoutLocation = zoteroCommandInputDefinition.buildViewNode!({
      key: 'zotero-command-input',
      id: 'command-zotero',
      state,
      start: { event: match.event, role: 'start' },
    } as never) as { location?: unknown } | null
    expect(withoutLocation?.location).toEqual({ kind: 'unresolved' })

    const withoutStart = zoteroCommandInputDefinition.buildViewNode!({
      key: 'zotero-command-input',
      id: 'command-zotero',
      state,
    } as never) as { location?: unknown } | null
    expect(withoutStart?.location).toEqual({ kind: 'unresolved' })
  })

  it('rejects a start that is not a command/run', () => {
    const done = {
      event: {
        type: 'command/done',
        seq: 2,
        time: 1_700_000_000_001,
        data: { commandId: 'command-zotero', kind: 'success', text: 'ok' },
      },
      role: 'start' as const,
      location: { kind: 'session' as const },
    }
    expect(() =>
      zoteroCommandInputDefinition.start({} as never, done as never, {} as never),
    ).toThrow('zotero-command-input start requires command/run')
  })

  it('renders the command bubble and only decorates the leading token', () => {
    const t = makeTranslate(zh)
    const props = {
      node: {
        key: 'zotero-command-input:one',
        data: {
          commandId: 'command-zotero',
          text: '/zotero status',
          time: 1_700_000_000_000,
        },
      },
      t,
    } as unknown as Parameters<typeof ZoteroCommandInputView>[0]
    const view = render(<ZoteroCommandInputView {...props} />)
    const bubble = view.getByRole('group', { name: zh.commandInputAria })
    expect(bubble.textContent).toBe('/zotero status')
    expect(within(bubble).queryByRole('button')).toBeNull()
    const chips = [...bubble.querySelectorAll('[data-ref-chip]')]
    expect(chips.map((chip) => [chip.getAttribute('data-ref-chip'), chip.textContent])).toEqual([
      ['command', '/zotero'],
    ])
  })

  it('renders a bare /zotero as one command chip', () => {
    const t = makeTranslate(zh)
    const props = {
      node: {
        key: 'zotero-command-input:bare',
        data: {
          commandId: 'command-zotero',
          text: '/zotero',
          time: 1_700_000_000_000,
        },
      },
      t,
    } as unknown as Parameters<typeof ZoteroCommandInputView>[0]
    const view = render(<ZoteroCommandInputView {...props} />)
    const bubble = view.getByRole('group', { name: zh.commandInputAria })
    expect(bubble.textContent).toBe('/zotero')
    expect([...bubble.querySelectorAll('[data-ref-chip]')].map((chip) => chip.textContent)).toEqual(
      ['/zotero'],
    )
  })
})
