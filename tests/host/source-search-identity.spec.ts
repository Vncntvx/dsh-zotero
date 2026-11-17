/** Search episodes normalize defaults and retain the result-set item level. */
import { expect, it } from 'vitest'
import { buildSourceWorkspace, SourceWorkspaceIndex } from '../../src/sources/ledger.ts'
import { sourceWorkspaceSchema } from '../../src/sources/workspace-schema.ts'
import { REF, searchMetaOf, settledBlock, runningBlock } from './support/source-ledger-arms.ts'

function episodes(first: Record<string, unknown>, second: Record<string, unknown>) {
  const ref = REF('ABCD1234')
  return buildSourceWorkspace([
    settledBlock(
      'first',
      'zotero_search',
      { query: 'attention', ...first },
      searchMetaOf([{ ref }]),
      1,
    ),
    settledBlock(
      'second',
      'zotero_search',
      { query: 'attention', offset: 1, ...second },
      searchMetaOf([{ ref }]),
      2,
    ),
  ])
}
it('keeps top-level and all-item searches in distinct episodes', () => {
  const workspace = episodes({ itemLevel: 'top' }, { itemLevel: 'all' })
  expect(
    workspace.sources[0]!.searches.map(({ itemLevel, returned }) => ({ itemLevel, returned })),
  ).toEqual([
    { itemLevel: 'top', returned: 1 },
    { itemLevel: 'all', returned: 1 },
  ])
  expect(sourceWorkspaceSchema.safeParse(workspace).success).toBe(true)
})
it('merges an implicit-default first page with an explicit-default continuation', () => {
  const workspace = episodes({}, { sort: 'dateModified', direction: 'desc', itemLevel: 'top' })
  expect(workspace.sources[0]!.searches).toHaveLength(1)
  expect(workspace.sources[0]!.searches[0]).toMatchObject({ itemLevel: 'top', returned: 2 })
})
it.each([{ sort: 'title' }, { direction: 'asc' }])(
  'keeps an actual ordering change in another episode: %s',
  (changed) => {
    expect(episodes({}, changed).sources[0]!.searches).toHaveLength(2)
  },
)

it('keeps a running search visible as a session operation before it has any item refs', () => {
  const index = new SourceWorkspaceIndex()
  const empty = index.workspace([])
  const running = index.workspace([
    runningBlock('searching', 'zotero_search', { query: 'attention' }),
  ])
  expect(running).not.toBe(empty)
  expect(running.searchOperations).toEqual({ running: 1, failed: 0, stopped: 0 })
  expect(running.sources).toEqual([])
  expect(index.workspace([]).searchOperations.running).toBe(0)
})

it.each([
  { code: 'ZOTERO_NOT_RUNNING', field: 'failed' },
  { code: 'interrupted', field: 'stopped' },
] as const)(
  'counts a ref-less $field search without treating it as a result',
  ({ code, field }) => {
    const block = settledBlock('failed-search', 'zotero_search', { query: 'attention' }, null, 1)
    const workspace = buildSourceWorkspace([
      { ...block, isError: true, error: { name: 'Error', code } },
    ])
    expect(workspace.searchOperations).toEqual({
      running: 0,
      failed: Number(field === 'failed'),
      stopped: Number(field === 'stopped'),
    })
    expect(workspace.sources).toEqual([])
    expect(sourceWorkspaceSchema.safeParse(workspace).success).toBe(true)
  },
)
