// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import {
  composer,
  documentRead,
  parsedRuntime,
  METADATA,
  REF,
  SESSION,
} from './support/parsed-document.tsx'
import { parsedArtifactTabAddress } from '../../../src/client/parsed-tab.ts'
import { ParsedDocumentTab } from '../../../src/client/components/library/ParsedDocumentTab.tsx'
import { mockT } from '../helpers/mock-translate.ts'
import { deferred } from '../../helpers/sync.ts'

const owned: Awaited<ReturnType<typeof parsedRuntime>>[] = []
afterEach(async () => {
  cleanup()
  for (const runtime of owned.splice(0)) await runtime.dispose()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

it('locates the captured plain text in the exact source attachment from an artifact tab', async () => {
  const runtime = await parsedRuntime(documentRead('**Selected passage**', { sourceRef: REF }))
  owned.push(runtime)
  const locatePdf = vi.fn().mockResolvedValue(true)
  runtime.mount({
    locatePdf,
    address: parsedArtifactTabAddress({ sessionId: SESSION, artifactId: METADATA.artifactId }),
  })
  const range = document.createRange()
  Object.defineProperties(range, {
    getClientRects: { value: () => [] },
    getBoundingClientRect: { value: () => ({ left: 12, right: 88, bottom: 30 }) },
  })
  vi.spyOn(window.getSelection()!, 'getRangeAt').mockReturnValue(range)
  range.selectNodeContents(await screen.findByText('Selected passage'))
  const selection = window.getSelection()!
  selection.removeAllRanges()
  selection.addRange(range)
  await act(async () => document.dispatchEvent(new Event('selectionchange')))
  await screen.findByRole('menu')
  window.getSelection()!.removeAllRanges()
  fireEvent.click(screen.getByRole('menuitem', { name: mockT('parsedLocatePdf') }))
  expect(locatePdf).toHaveBeenCalledExactlyOnceWith(
    SESSION,
    REF,
    {
      quote: 'Selected passage',
      sourceType: 'mineru',
      contentFingerprint: `sha256:${METADATA.fingerprint}`,
    },
    expect.any(AbortSignal),
  )
})

it('marks a unique parsed block and removes it when the navigation fingerprint changes', async () => {
  const runtime = await parsedRuntime(
    documentRead('First block\n\nSelected passage', { sourceRef: REF }),
  )
  owned.push(runtime)
  const passage = {
    quote: 'Selected passage',
    fingerprint: METADATA.fingerprint,
    attachmentRef: REF,
  }
  const view = runtime.mount({ passage })
  await screen.findByText(mockT('parsedPassageFound'))
  expect(screen.getByText('Selected passage').hasAttribute('data-parsed-passage')).toBe(true)
  view.rerender(
    <ParsedDocumentTab {...runtime.props({ passage: { ...passage, fingerprint: 'stale' } })} />,
  )
  await screen.findByText(mockT('parsedPassageChanged'))
  expect(screen.getByText('Selected passage').hasAttribute('data-parsed-passage')).toBe(false)
})

it('offers no arbitrary target when the parsed passage repeats', async () => {
  const runtime = await parsedRuntime(
    documentRead('Selected passage\n\nSecond Selected passage', { sourceRef: REF }),
  )
  owned.push(runtime)
  const view = runtime.mount({
    passage: { quote: 'Selected passage', fingerprint: METADATA.fingerprint, attachmentRef: REF },
  })
  await screen.findByText(mockT('parsedPassageAmbiguous'))
  expect(view.container.querySelector('[data-parsed-passage]')).toBeNull()
})

it('reopens a cited range across rich markup and drops it if its source text has shifted', async () => {
  const runtime = await parsedRuntime(
    documentRead('Uncited **Selected** passage', { sourceRef: REF }),
  )
  owned.push(runtime)
  const registry = new Map<string, Set<Range>>()
  vi.stubGlobal('CSS', { highlights: registry })
  vi.stubGlobal('Highlight', Set)
  const passage = {
    textRange: { start: 8, end: 24 },
    textPrefix: 'Selected passage',
    fingerprint: METADATA.fingerprint,
    attachmentRef: REF,
  }
  const view = runtime.mount({ passage })
  await screen.findByText(mockT('parsedPassageFound'))
  const highlights = () => [...(registry.get('zotero-parsed-cited-text') ?? [])]
  expect(highlights().map((range) => range.toString())).toEqual([passage.textPrefix])
  // The fingerprint still matches the cached source. Its rendered offset has moved.
  const shifted = { ...passage, textRange: { start: 7, end: 23 } }
  view.rerender(<ParsedDocumentTab {...runtime.props({ passage: shifted })} />)
  await screen.findByText(mockT('parsedPassageMissing'))
  expect(highlights()).toEqual([])
})

it('links a textless figure with verified geometry and uses page precision for an equation without a box', async () => {
  const box = [100, 200, 300, 400] as const
  const runtime = await parsedRuntime(
    documentRead('Cached Markdown', {
      sourceRef: REF,
      locations: [
        { pageIndex: 1, kind: 'image', box },
        { pageIndex: 2, kind: 'equation', label: 't = 3' },
      ],
    }),
  )
  owned.push(runtime)
  const locatePdf = vi.fn().mockResolvedValue(true)
  const view = runtime.mount({
    locatePdf,
    passage: {
      region: { pageIndex: 1, box: [110, 220, 290, 390] },
      fingerprint: METADATA.fingerprint,
      attachmentRef: REF,
    },
  })
  await screen.findByText(mockT('parsedRegionFound'))
  const matched = view.container.querySelector('[data-parsed-passage]')
  expect(matched?.textContent).toContain(mockT('parsedLocation_image'))
  for (const button of screen.getAllByRole('button', { name: mockT('parsedLocatePdf') }))
    fireEvent.click(button)
  expect(locatePdf.mock.calls.map(([, , evidence]) => evidence)).toEqual([
    { contentFingerprint: `sha256:${METADATA.fingerprint}`, artifactRegion: { pageIndex: 1, box } },
    { contentFingerprint: `sha256:${METADATA.fingerprint}`, artifactRegion: { pageIndex: 2 } },
  ])
})

it('requires a single region match when the selection spans two parsed entries', async () => {
  const runtime = await parsedRuntime(
    documentRead('Cached Markdown', {
      sourceRef: REF,
      locations: [
        { pageIndex: 1, kind: 'image', box: [100, 200, 300, 400] },
        { pageIndex: 1, kind: 'table', box: [500, 500, 700, 600] },
      ],
    }),
  )
  owned.push(runtime)
  const view = runtime.mount({
    passage: {
      region: { pageIndex: 1, box: [100, 200, 900, 900] },
      fingerprint: METADATA.fingerprint,
      attachmentRef: REF,
    },
  })
  await screen.findByText(mockT('parsedRegionMissing'))
  expect(view.container.querySelector('[data-parsed-passage]')).toBeNull()
})

it('quotes an equation with its verified artifact fingerprint and physical page', async () => {
  const sourceRef = `${REF}?server=fixture`
  const box = [100, 200, 300, 400] as const
  const runtime = await parsedRuntime(
    documentRead('Cached Markdown', {
      sourceRef,
      locations: [{ pageIndex: 2, kind: 'equation', label: 't = 3', box }],
    }),
  )
  owned.push(runtime)
  const actions = composer()
  runtime.mount({ actions })
  fireEvent.click(await screen.findByText(mockT('parsedLocations')))
  fireEvent.click(screen.getByRole('button', { name: mockT('parsedQuoteLocation') }))
  const quote = actions.insertQuote.mock.calls[0]?.[0] as string
  expect(quote).toContain('t = 3')
  expect(JSON.parse(quote.split('\n\n').at(-1)!)).toMatchObject({
    title: expect.stringContaining('t = 3'),
    attachmentRef: sourceRef,
    fingerprint: `sha256:${METADATA.fingerprint}`,
    instanceId: 'fixture',
    sourceType: 'mineru',
    artifactId: METADATA.artifactId,
    entryKind: 'equation',
    pages: [{ pageIndex: 2, artifactBox: box }],
  })
  expect(actions.persistDraft).toHaveBeenCalledOnce()
})

it('highlights a uniquely matched figure caption for parsed region navigation', async () => {
  const box = [100, 200, 300, 400] as const
  const caption = 'Reaction time by condition'
  const runtime = await parsedRuntime(
    documentRead(`Baseline and control\n\n${caption}`, {
      sourceRef: REF,
      locations: [{ pageIndex: 1, kind: 'image', label: caption, box }],
    }),
  )
  owned.push(runtime)
  const passage = {
    region: { pageIndex: 1, box },
    fingerprint: METADATA.fingerprint,
    attachmentRef: REF,
  }
  const view = runtime.mount({ passage })
  await screen.findByText(mockT('parsedRegionFound'))
  expect(view.container.querySelector('p[data-parsed-passage]')?.textContent).toBe(caption)
  view.rerender(<ParsedDocumentTab {...runtime.props({})} />)
  expect(view.container.querySelector('p[data-parsed-passage]')).toBeNull()
})

it('reports rejected and failed PDF navigation and clears the message on retry', async () => {
  const runtime = await parsedRuntime(
    documentRead('Cached Markdown', {
      sourceRef: REF,
      locations: [{ pageIndex: 2, kind: 'equation', label: 't = 3' }],
    }),
  )
  owned.push(runtime)
  const locatePdf = vi
    .fn()
    .mockResolvedValueOnce(false)
    .mockRejectedValueOnce(new Error('Source unavailable'))
    .mockResolvedValueOnce(true)
  runtime.mount({ locatePdf })
  fireEvent.click(await screen.findByText(mockT('parsedLocations')))
  const locate = screen.getByRole('button', { name: mockT('parsedLocatePdf') })
  fireEvent.click(locate)
  await screen.findByText(mockT('parsedLocatePdfFailed'))
  await act(async () => fireEvent.click(locate))
  expect(screen.getByText(mockT('parsedLocatePdfFailed'))).toBeTruthy()
  await act(async () => fireEvent.click(locate))
  expect(screen.queryByText(mockT('parsedLocatePdfFailed'))).toBeNull()
  expect(locatePdf).toHaveBeenCalledTimes(3)
})

it('keeps only the latest PDF jump and ignores failure from a superseded jump', async () => {
  const runtime = await parsedRuntime(
    documentRead('Cached Markdown', {
      sourceRef: REF,
      locations: [
        { pageIndex: 2, kind: 'equation', label: 't = 3' },
        { pageIndex: 3, kind: 'table', label: 'Results' },
      ],
    }),
  )
  owned.push(runtime)
  const first = deferred<boolean>()
  const locatePdf = vi
    .fn<NonNullable<Parameters<typeof ParsedDocumentTab>[0]['locatePdf']>>()
    .mockReturnValueOnce(first.promise)
    .mockResolvedValueOnce(true)
  runtime.mount({ locatePdf })
  fireEvent.click(await screen.findByText(mockT('parsedLocations')))
  const [equation, table] = screen.getAllByRole('button', { name: mockT('parsedLocatePdf') })
  fireEvent.click(equation!)
  await act(async () => fireEvent.click(table!))

  expect(locatePdf.mock.calls[0]![3].aborted).toBe(true)
  expect(locatePdf.mock.calls[1]![2]).toMatchObject({ artifactRegion: { pageIndex: 3 } })
  expect(locatePdf.mock.calls[1]![3].aborted).toBe(false)
  await act(async () => first.reject(new Error('Original source lookup failed')))
  expect(screen.queryByText(mockT('parsedLocatePdfFailed'))).toBeNull()
})

it.each(['zotero/resolveAttachment', 'workspaceFiles/readBytes'])(
  'cancels an in-flight PDF jump when %s is revoked',
  async (method) => {
    const runtime = await parsedRuntime(
      documentRead('Cached Markdown', {
        sourceRef: REF,
        locations: [{ pageIndex: 2, kind: 'equation', label: 't = 3' }],
      }),
    )
    owned.push(runtime)
    const answer = deferred<boolean>()
    const locatePdf = vi
      .fn<NonNullable<Parameters<typeof ParsedDocumentTab>[0]['locatePdf']>>()
      .mockReturnValueOnce(answer.promise)
      .mockResolvedValueOnce(true)
    runtime.mount({ locatePdf })
    fireEvent.click(await screen.findByText(mockT('parsedLocations')))
    fireEvent.click(screen.getByRole('button', { name: mockT('parsedLocatePdf') }))
    const signal = locatePdf.mock.calls[0]![3]

    act(() => runtime.grant(method).publish(false))
    expect(signal.aborted).toBe(true)
    expect(screen.queryByRole('button', { name: mockT('parsedLocatePdf') })).toBeNull()
    await act(async () => answer.resolve(false))
    expect(screen.queryByText(mockT('parsedLocatePdfFailed'))).toBeNull()
    act(() => runtime.grant(method).publish(true))
    await act(async () =>
      fireEvent.click(screen.getByRole('button', { name: mockT('parsedLocatePdf') })),
    )
    expect(locatePdf).toHaveBeenCalledTimes(2)
  },
)
