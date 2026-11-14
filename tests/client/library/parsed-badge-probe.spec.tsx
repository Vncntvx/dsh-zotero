// @vitest-environment jsdom
/** The library badges answer one batched probe and re-probe on commits and discards. */
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { useParsedArtifacts } from '../../../src/client/components/library/LibraryItemList.tsx'
import { ParsedDocuments } from '../../../src/client/parsed-documents.ts'
import type { ZoteroSearchItemView } from '../../../src/contract.ts'

const owned: Array<{ dispose(): void }> = []
afterEach(() => {
  cleanup()
  for (const runtime of owned.splice(0)) runtime.dispose()
  vi.restoreAllMocks()
})

const REF = 'zotero://user/0/attachment/PDF00001'
const OTHER = 'zotero://user/0/attachment/PDF00002'
const items = (refs: readonly string[]) =>
  refs.map(
    (ref) =>
      ({
        ref,
        title: 'Paper',
        creatorSummary: '',
        itemType: 'journalArticle',
        bestAttachmentType: 'application/pdf',
        bestAttachmentRef: ref,
      }) as ZoteroSearchItemView,
  )

function probeFace(options: { ready?: ReadonlySet<string> } = {}) {
  const ready = options.ready
  const read = vi.fn(async (request: { op: string; refs?: readonly string[] }) => {
    if (request.op === 'probe') {
      return {
        ok: true as const,
        value: {
          kind: 'probed' as const,
          results: (request.refs ?? []).map((ref) => ({
            ref,
            state: ready?.has(ref) ? ('ready' as const) : ('missing' as const),
          })),
        },
      }
    }
    throw new Error(`unexpected ${request.op}`)
  })
  const documents = new ParsedDocuments(
    read,
    () => ({ getSnapshot: () => true, subscribe: () => () => {} }),
    vi.fn(),
  )
  owned.push({ dispose: () => {} })
  return { read, documents }
}

function ProbeHost(props: {
  items: readonly ZoteroSearchItemView[]
  face: Parameters<typeof useParsedArtifacts>[1]
}) {
  const parsed = useParsedArtifacts(props.items, props.face)
  return (
    <ul>
      {[...parsed].map((ref) => (
        <li key={ref}>{ref}</li>
      ))}
    </ul>
  )
}

it('answers one batched probe per page and maps ready states to badges', async () => {
  const { read } = probeFace({ ready: new Set([REF]) })
  const view = render(
    <ProbeHost
      items={items([REF, OTHER])}
      face={{ sessionId: 's1', read: read as never, revision: 0 }}
    />,
  )
  await act(async () => {})
  expect(read).toHaveBeenCalledTimes(1)
  expect(read.mock.calls[0]![0]).toMatchObject({ op: 'probe', refs: [REF, OTHER] })
  expect(screen.getByText(REF)).toBeDefined()
  expect(screen.queryByText(OTHER)).toBeNull()
  view.unmount()
})

it('renders no badges without read access and never probes', async () => {
  const { read } = probeFace({ ready: new Set([REF]) })
  const view = render(<ProbeHost items={items([REF])} face={{ sessionId: 's1', revision: 0 }} />)
  await act(async () => {})
  expect(read).not.toHaveBeenCalled()
  expect(screen.queryByText(REF)).toBeNull()
  view.unmount()
})

it('re-probes only the unknown rows on a page turn and honours the cache', async () => {
  const { read } = probeFace({ ready: new Set([REF]) })
  const view = render(
    <ProbeHost items={items([REF])} face={{ sessionId: 's1', read: read as never, revision: 0 }} />,
  )
  await act(async () => {})
  view.rerender(
    <ProbeHost
      items={items([REF, OTHER])}
      face={{ sessionId: 's1', read: read as never, revision: 0 }}
    />,
  )
  await act(async () => {})
  expect(read).toHaveBeenCalledTimes(2)
  expect(read.mock.calls[1]![0]).toMatchObject({ op: 'probe', refs: [OTHER] })
  view.unmount()
})

it('re-probes when the parse dialog revision changes', async () => {
  const ready = new Set<string>([REF])
  const { read } = probeFace({ ready })
  const view = render(
    <ProbeHost items={items([REF])} face={{ sessionId: 's1', read: read as never, revision: 0 }} />,
  )
  await act(async () => {})
  expect(screen.getByText(REF)).toBeDefined()
  ready.delete(REF)
  view.rerender(
    <ProbeHost items={items([REF])} face={{ sessionId: 's1', read: read as never, revision: 1 }} />,
  )
  await act(async () => {})
  expect(read).toHaveBeenCalledTimes(2)
  expect(screen.queryByText(REF)).toBeNull()
  view.unmount()
})

it('re-probes when the provider reports a commit or discard', async () => {
  const ready = new Set<string>([REF])
  const { read, documents } = probeFace({ ready })
  const view = render(
    <ProbeHost
      items={items([REF])}
      face={{ sessionId: 's1', read: read as never, revision: 0, documents }}
    />,
  )
  await act(async () => {})
  expect(screen.getByText(REF)).toBeDefined()
  // A discard from the manager tab: the badge disappears without any dialog.
  ready.delete(REF)
  act(() => documents.discarded('s1', 'b'.repeat(64)))
  await act(async () => {})
  expect(read).toHaveBeenCalledTimes(2)
  expect(screen.queryByText(REF)).toBeNull()
  // A commit from the inspector: the badge returns.
  ready.add(REF)
  act(() => documents.committed('s1', REF))
  await act(async () => {})
  expect(read).toHaveBeenCalledTimes(3)
  expect(screen.getByText(REF)).toBeDefined()
  view.unmount()
})
