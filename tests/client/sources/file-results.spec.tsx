// @vitest-environment jsdom
/** Persisted file facts survive projection, while body actions require a verified read. */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { receiptOf, ResultSessionContext } from '../../../src/client/result-reader.ts'
import { RESULT_RECEIPT_PREFIX } from '../../../src/constants.ts'
import { buildSourceWorkspace } from '../../../src/client/sources/reducer.ts'
import { ExportCard } from '../../../src/client/components/ExportCard.tsx'
import { settled, running } from '../helpers/blocks.ts'
import { mockT } from '../helpers/mock-translate.ts'
import { zh } from '../../../src/client/locales.ts'
import type { ExportArtifact } from '../../../src/client/sources/model.ts'
vi.mock('@deepseek-ai/dsh-client-ui-primitives', async () => {
  const { primitivesStub } = await import('../helpers/primitives-stub.ts')
  return primitivesStub()
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})
const file = { attachmentId: 'digest', name: 'result.json', bytes: 123 }
const facts = {
  format: 'csv',
  refs: ['zotero://user/0/item/ABCD1234'],
  refsOmitted: 0,
  requested: 1,
}
const receipt = {
  delivery: 'file',
  version: 1,
  tool: 'zotero_export',
  file,
  facts,
  summary: 'Stored',
  sessionId: 's',
  callId: 'origin',
}
function block(text = JSON.stringify(receipt)) {
  return settled({
    call: { name: 'job_output', argsRaw: '{"job_id":"job"}' },
    content: [
      { type: 'text', text: RESULT_RECEIPT_PREFIX + text + '\nUse file' },
      { type: 'file', attachment: file as never },
    ],
  })
}
it('attributes an owned background export to its original refs and retains a file coordinate', () => {
  const workspace = buildSourceWorkspace([block()])
  expect(workspace.exports).toHaveLength(1)
  expect(workspace.exports[0]).toMatchObject({
    format: 'csv',
    text: '',
    refs: facts.refs,
    resultFile: { seq: 2, index: 0 },
  })
  expect(workspace.sources[0]!.exports).toHaveLength(1)
})
it.each([
  'invalid',
  '{}',
  JSON.stringify({ ...receipt, delivery: 'inline' }),
  JSON.stringify({ ...receipt, tool: 'other' }),
  JSON.stringify({ ...receipt, file: { ...file, attachmentId: 'wrong' } }),
])('ignores malformed receipt %s', (text) => {
  expect(receiptOf(block(text))).toBeNull()
})
it('does not use failed, running or text-only receipts as evidence', () => {
  expect(receiptOf(running())).toBeNull()
  expect(receiptOf({ ...block(), isError: true })).toBeNull()
  expect(
    receiptOf({
      ...block(),
      content: [{ type: 'text', text: RESULT_RECEIPT_PREFIX + JSON.stringify(receipt) }],
    }),
  ).toBeNull()
})
const artifact: ExportArtifact = {
  callId: 'call',
  format: 'csv',
  refs: facts.refs,
  refsOmitted: 0,
  text: '',
  resultFile: { seq: 2, index: 0 },
}
it('keeps failed file reads retryable without offering summary downloads', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json({ version: 1, data: { summary: 'not a body' } })),
  )
  render(
    <ResultSessionContext.Provider value="s">
      <ExportCard artifact={artifact} t={mockT} />
    </ResultSessionContext.Provider>,
  )
  fireEvent.click(screen.getByRole('button', { name: zh.readCompleteResult }))
  expect(await screen.findByRole('alert')).toBeTruthy()
  expect(screen.queryByRole('button', { name: zh.copyExport })).toBeNull()
})

it.each([{ version: 2, data: {} }, { version: 1, data: [] }, null])(
  'rejects an invalid complete document %s',
  async (value) => {
    const { readCompleteResult } = await import('../../../src/client/result-reader.ts')
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json(value)),
    )
    await expect(readCompleteResult('s', { seq: 2, index: 0 })).rejects.toThrow(
      'Invalid complete result',
    )
  },
)
it('recovers per-ref citation HTML and refuses malformed citation body records', async () => {
  const { rawExportText } = await import('../../../src/client/result-reader.ts')
  expect(
    rawExportText({ format: 'citation', citations: [{ ref: 'ref', text: '<i>Title</i>  ' }] }),
  ).toBe('ref: <i>Title</i>  ')
  expect(
    rawExportText({ format: 'citation', citations: [{ text: 'missing attribution' }] }),
  ).toBeUndefined()
  expect(rawExportText({ summary: 'stored' })).toBeUndefined()
})
