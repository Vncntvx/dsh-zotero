// @vitest-environment jsdom
import type { Context } from '@deepseek-ai/cordis'
import type {
  UserTextNodeProps,
  UserTextRule,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {
  InputTriggerPick,
  InputTriggerSource,
} from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ComponentProps, ComponentType } from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { registerPaperReferences, zoteroRefsIn } from '../../src/client/paper-reference.tsx'
import { mockT } from './helpers/mock-translate.ts'
import { createRemoteAccessStub } from './helpers/remote-stubs.ts'

const ref = 'zotero://user/0/item/PAPER001?server=S1'
const invalid = 'zotero://user/2/item/PAPER001'
const entry = { ref, title: 'Flood records', creatorSummary: 'A. Paper' }

function setup(allowed = new Set(['zotero/search', 'zotero/item'])) {
  const lookup = vi.fn(async (_args: unknown) => ({
    ok: true,
    value: { items: [entry, { ref: 'malformed' }] },
  }))
  const item = vi.fn(async (_args: unknown) => ({ ok: true, value: entry }))
  const source = vi.fn((_source: InputTriggerSource) => () => {})
  const text = vi.fn((_rule: UserTextRule<'zoteroPaper'>) => () => {})
  type Node = ComponentType<
    UserTextNodeProps<'zoteroPaper'> & {
      t: typeof mockT
      openRef: (ref: string) => void
    }
  >
  const registered = vi.fn((_options: unknown, _view: Node) => () => {})
  const ctx = {
    locale: { bind: () => mockT },
    remote: { zotero: { search: lookup, item } },
    remoteAccess: createRemoteAccessStub(allowed),
    inputTriggers: { registerSource: source },
    uiConversation: { userText: { register: text } },
    slots: {
      register: registered,
      inject: (_name: string, action: () => unknown) => action(),
    },
    inject: (_keys: readonly string[], action: (scope: unknown) => unknown) => action(ctx),
    effect: (action: () => unknown) => action(),
  }
  const open = vi.fn(async (_url: string) => true)
  const failed = vi.fn()
  const openRef = registerPaperReferences(ctx as unknown as Context, open, failed)
  return {
    lookup,
    item,
    open,
    failed,
    openRef,
    source: source.mock.calls[0]?.[0],
    rule: text.mock.calls[0]![0],
    Chip: registered.mock.calls[0]![1],
  }
}

afterEach(cleanup)

it('parses full item and attachment refs with boundary and provenance checks', () => {
  const attachment = 'zotero://group/42/attachment/PDF00001'
  const sample = `x${ref} ${invalid} ${ref}/suffix [${ref}] ${attachment} zotero://user/0/collection/COLL0001`
  expect(zoteroRefsIn(sample).map((hit) => hit.ref)).toEqual([ref, attachment])
  expect(zoteroRefsIn(sample, sample.indexOf(attachment)).map((hit) => hit.ref)).toEqual([
    attachment,
  ])
  const { rule } = setup()
  expect(rule.match('before ' + ref, 0, {} as never)).toMatchObject({
    start: 7,
    data: { label: 'PAPER001', ref },
  })
  expect(rule.match('plain or invalid ' + invalid, 0, {} as never)).toBeUndefined()
})

it('fetches only the paper trigger and revalidates the chip when sending or opening', async () => {
  const { source, lookup, item, open, failed } = setup()
  const signal = new AbortController().signal
  const candidates = async (query: string) =>
    await source!.candidates({} as never, {
      query,
      position: 'leading',
      drilled: false,
      signal,
    })
  expect(await candidates('other')).toEqual([])
  expect(lookup).not.toHaveBeenCalled()
  const [hit] = await candidates('paper:flood')
  expect(hit).toMatchObject({ label: entry.title, value: ref })
  expect(lookup).toHaveBeenCalledWith(expect.objectContaining({ q: 'flood' }), signal)
  const pick = (candidate: InputTriggerPick['candidate']) =>
    source!.onPick({ candidate } as InputTriggerPick)
  expect(pick({ name: 'missing' })).toBeUndefined()
  expect(pick({ name: 'invalid', value: 'x' })).toBeUndefined()
  expect(pick(hit!)).toMatchObject({ insert: { ref, label: entry.title, clipboardText: ref } })
  expect(pick({ name: 'alias', value: ref })).toMatchObject({ insert: { label: 'alias' } })
  expect(source!.codec!.clipboardText(ref)).toBe(ref)
  expect(await source!.codec!.serialize(ref, signal)).toBe(ref)
  expect(item).toHaveBeenCalledWith({ ref, include: [] }, signal)
  await expect(source!.codec!.serialize('x', signal)).rejects.toThrow()
  expect(source!.openReference!({} as never, { ref: 'x' })).toBe(false)
  expect(source!.openReference!({} as never, { ref })).toBe(true)
  await vi.waitFor(() =>
    expect(open).toHaveBeenCalledWith('zotero://select/library/items/PAPER001'),
  )
  item.mockResolvedValueOnce({ ok: false, value: entry })
  await expect(source!.codec!.serialize(ref, signal)).rejects.toThrow()
  item.mockResolvedValueOnce({ ok: true, value: { ...entry, ref: 'x' } })
  await expect(source!.codec!.serialize(ref, signal)).rejects.toThrow()
  item.mockRejectedValueOnce(new Error('offline'))
  source!.openReference!({} as never, { ref })
  await vi.waitFor(() => expect(failed).toHaveBeenCalledOnce())
  item.mockResolvedValueOnce({ ok: false, value: entry })
  source!.openReference!({} as never, { ref })
  await vi.waitFor(() => expect(failed).toHaveBeenCalledTimes(2))
  lookup.mockResolvedValueOnce({ ok: false, value: { items: [] } })
  await expect(candidates('paper')).rejects.toThrow()
})

it('keeps the user message readable with controls gated on current access', () => {
  expect(setup(new Set(['zotero/search'])).source).toBeUndefined()
  expect(setup(new Set(['zotero/item'])).source).toBeUndefined()
  const { Chip, rule } = setup()
  const openRef = vi.fn()
  const node = rule.match(ref, 0, {} as never)!
  const props = { node, raw: ref, interactive: true, openRef, t: mockT } as ComponentProps<
    typeof Chip
  >
  const { rerender } = render(<Chip {...props} useAccess={() => true} />)
  fireEvent.click(screen.getByRole('button'))
  expect(openRef).toHaveBeenCalledWith(ref)
  rerender(<Chip {...props} useAccess={(action) => action !== 'zotero/openProtocol'} />)
  expect(screen.getByText(ref)).toBeTruthy()
  rerender(<Chip {...props} interactive={false} useAccess={() => true} />)
  expect(screen.queryByRole('button')).toBeNull()
})
