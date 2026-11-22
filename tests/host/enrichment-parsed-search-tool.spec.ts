/** Pinned tools pipeline schema validation and parsed evidence projection. */
import { expect, it, vi } from 'vitest'
import { PARSED_SEARCH_TOOL } from '../../src/constants.ts'
import { registerParsedSearchTool } from '../../src/enrichment/search-parsed-tool.ts'
import { identityToolWrapper } from '../../src/result-delivery.ts'
import { expectValue, setupHostLane } from '../helpers/lanes/host-lane.ts'
import { resultStorage } from '../helpers/result-storage.ts'
import { ARTIFACT, CACHE_KEY } from './support/enrichment-artifacts.ts'

const scope = { kind: 'artifacts', artifactIds: [CACHE_KEY] }
const query = 'resilience'
const passage = {
  artifactId: CACHE_KEY,
  sourceId: ARTIFACT.meta.sourceId,
  generation: ARTIFACT.meta.generation,
  mode: 'pro' as const,
  fingerprint: ARTIFACT.meta.contentFingerprint,
  heading: 'Validation',
  start: 0,
  end: 15,
  text: 'resilience data',
}
const result = {
  query,
  queryTerms: [query],
  coverage: { status: 'complete' as const, discovered: 1, searchable: 1, stale: 0, missing: 0 },
  passages: [passage],
}

it('rejects malformed boundaries before search starts and forwards the authorized scope', async () => {
  const lane = await setupHostLane()
  const search = vi.fn(async () => result)
  try {
    await lane.ctx.plugin({
      inject: ['tools'],
      apply: (ctx) => registerParsedSearchTool(ctx, search, identityToolWrapper),
    })
    const run = (args: Record<string, unknown>) =>
      lane.runTool(PARSED_SEARCH_TOOL, { query, scope, ...args })
    for (const input of [
      { limit: 61 },
      { query: '  ' },
      { query: 'a'.repeat(2001) },
      { queryVariants: ['a', 'b', 'c', 'd'] },
      { queryVariants: [' '] },
      { scope: { kind: 'artifacts', artifactIds: [] } },
      { scope: { kind: 'artifacts', artifactIds: Array(61).fill(CACHE_KEY) } },
      { scope: { kind: 'artifacts', artifactIds: ['bad'] } },
      { scope: { kind: 'collection', ref: 'zotero://user/0/item/ABCD1234' } },
      { scope: { kind: 'library', library: { type: 'user', id: 2 } } },
    ]) {
      expect((await run(input)).isError).toBe(true)
    }
    expect(search).not.toHaveBeenCalled()
    expect(expectValue(await run({ queryVariants: ['flood'] }), PARSED_SEARCH_TOOL).value).toEqual(
      result,
    )
    expect(search).toHaveBeenLastCalledWith(
      { query, variants: ['flood'], scope, limit: 20 },
      expect.any(AbortSignal),
    )
    const library = { type: 'user', id: 0 }
    expect(
      expectValue(await run({ scope: { kind: 'library', library } }), PARSED_SEARCH_TOOL).value,
    ).toEqual(result)
    expect(search).toHaveBeenLastCalledWith(
      { query, scope: { kind: 'library', library }, limit: 20 },
      expect.any(AbortSignal),
    )
  } finally {
    await lane.teardown()
  }
})

it('publishes compact evidence identities alongside any bounded passage preview', async () => {
  const lane = await setupHostLane()
  const attachmentRef = 'zotero://user/0/attachment/PDF00001'
  const itemRef = 'zotero://user/0/item/PAPER001'
  const observations = {
    ...result,
    passages: [
      { ...passage, attachmentRef, itemRef },
      { ...passage, attachmentRef },
      { ...passage, text: 'x'.repeat(180) },
    ],
  }
  try {
    await lane.ctx.plugin({
      inject: ['tools'],
      apply: (ctx) => registerParsedSearchTool(ctx, async () => observations, identityToolWrapper),
    })
    const tool = lane.tool(PARSED_SEARCH_TOOL)!
    expect(tool.output.presentationMeta?.({ query, scope }, observations)).toMatchObject({
      mode: 'parsedSearch',
      evidenceRefs: [itemRef, attachmentRef, CACHE_KEY],
      items: [
        { sourceRef: itemRef, attachmentRef, previewTruncated: false },
        { sourceRef: attachmentRef },
        { sourceRef: 'artifact:' + CACHE_KEY, previewTruncated: true },
      ],
    })
    const content = tool.output.render({ query, scope }, observations)
    expect(content).toMatchObject([
      { type: 'text', text: expect.stringContaining('Stored Markdown coverage complete') },
    ])
    expect(JSON.stringify(content)).toContain(passage.generation)
  } finally {
    await lane.teardown()
  }
})

it('keeps the parsed tool output programmatic and marks an oversized native result with its file', async () => {
  const lane = await setupHostLane(
    { maxInlineResultBytes: 8192 },
    {
      compose: async (ctx) => {
        resultStorage(ctx)
      },
    },
  )
  const passages = Array.from({ length: 15 }, (_, i) => ({
    ...passage,
    artifactId: i.toString(16).padStart(64, '0'),
    text: 'real evidence wording '.repeat(80),
  }))
  try {
    await lane.ctx.plugin({
      inject: ['tools', 'zotero'],
      apply: (ctx) =>
        registerParsedSearchTool(
          ctx,
          async () => ({ ...result, passages }),
          ctx.zotero.wrapReadTool,
        ),
    })
    const settled = expectValue(
      await lane.runTool(PARSED_SEARCH_TOOL, { query, scope }),
      PARSED_SEARCH_TOOL,
    )
    expect(settled.value).toEqual({ ...result, passages })
    expect(settled.content).toContainEqual(expect.objectContaining({ type: 'file' }))
    expect(settled.meta).toMatchObject({
      delivery: 'file',
      detailOmitted: true,
      evidenceRefs: passages.slice(0, 12).map((row) => row.artifactId),
    })
  } finally {
    await lane.teardown()
  }
})
