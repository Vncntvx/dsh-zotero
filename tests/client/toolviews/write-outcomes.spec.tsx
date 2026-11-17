// @vitest-environment jsdom
/** Persisted write receipts must retain the operation and its actual outcome. */
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { en, zh } from '../../../src/client/locales.ts'
import { WriteToolView, type WriteToolName } from '../../../src/client/toolviews/WriteToolView.tsx'
import { makeTranslate } from '../helpers/mock-translate.ts'
import { createToolViewProps, mockUseDisclosure } from '../helpers/mock-disclosure.ts'
import { settled } from '../helpers/blocks.ts'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  SCHOLARLY_SAVE_STATES,
  scholarlySaveOutcome,
} from '../../helpers/scholarly-save-outcomes.js'

const capturedReceipts = JSON.parse(
  readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '../../fixtures/scholarly-save-receipts.json'),
    'utf8',
  ),
) as Record<string, { content: unknown[]; meta: Record<string, unknown> }>

afterEach(cleanup)

const REF = 'zotero://user/0/item/NOTE0001?server=srv-save'

describe('Scholarly persisted write outcomes', () => {
  it.each(SCHOLARLY_SAVE_STATES)(
    'replays %s from runtime content and meta alone',
    async (state) => {
      const outcome = scholarlySaveOutcome(state)
      const result = capturedReceipts[state]!
      expect(result.meta).toMatchObject({ kind: outcome.kind })
      const block = settled({
        call: { name: 'scholarly_save_to_zotero', argsRaw: JSON.stringify({ title: 'A study' }) },
        ...JSON.parse(JSON.stringify({ content: result.content, meta: result.meta })),
      })
      const { container } = render(
        <WriteToolView {...createToolViewProps({ toolName: 'scholarly_save_to_zotero', block })} />,
      )
      const expected = state === 'declined' ? 'declined' : state === 'applied' ? 'ok' : 'unverified'
      expect(container.querySelector('[data-tool]')?.getAttribute('data-state')).toBe(expected)
      // Only a fully applied write wears the success tone; every other outcome
      // must not read as one, which is what makes the negative check below bite.
      if (state === 'applied') {
        expect(container.querySelector('[data-tone="success"]')).not.toBeNull()
      } else {
        expect(container.querySelector('[data-tone="success"]')).toBeNull()
      }
      if (state !== 'applied' && state !== 'declined') {
        expect(container.textContent).toContain(REF)
        expect(result.meta).toMatchObject({
          reason: state,
          retryable: false,
          key: 'NOTE0001',
          ref: REF,
          version: 12,
        })
      }
    },
  )
})

const operations: {
  name: WriteToolName
  title: keyof typeof zh
  summary: keyof typeof zh
  args: Record<string, unknown>
  params: Record<string, unknown>
}[] = [
  {
    name: 'zotero_update_note',
    title: 'toolTitleUpdateNote',
    summary: 'toolSummaryUpdateNote',
    args: { markdown: '# Revised' },
    params: { title: 'Revised' },
  },
  {
    name: 'zotero_update_collection',
    title: 'toolTitleUpdateCollection',
    summary: 'toolSummaryUpdateCollection',
    args: { collection: 'COLL0001' },
    params: { name: 'COLL0001' },
  },
  {
    name: 'zotero_create_saved_search',
    title: 'toolTitleCreateSavedSearch',
    summary: 'toolSummaryCreateSavedSearch',
    args: { name: 'Reading' },
    params: { name: 'Reading' },
  },
  {
    name: 'zotero_update_saved_search',
    title: 'toolTitleUpdateSavedSearch',
    summary: 'toolSummaryUpdateSavedSearch',
    args: { search: 'SEARCH01' },
    params: { name: 'SEARCH01' },
  },
  {
    name: 'zotero_delete_saved_search',
    title: 'toolTitleDeleteSavedSearch',
    summary: 'toolSummaryDeleteSavedSearch',
    args: { search: 'SEARCH01' },
    params: { name: 'SEARCH01' },
  },
  {
    name: 'scholarly_save_to_zotero',
    title: 'toolTitleScholarlySave',
    summary: 'toolSummaryScholarlySave',
    args: { title: 'Study' },
    params: { title: 'Study' },
  },
]

describe.each([
  ['zh', zh],
  ['en', en],
] as const)('%s operation labels', (_locale, dictionary) => {
  it.each(operations)('names $name in both collapsed and expanded receipts', (operation) => {
    const t = makeTranslate(dictionary)
    for (const expanded of [false, true]) {
      const block = settled({
        call: { name: operation.name, argsRaw: JSON.stringify(operation.args) },
        meta: { kind: 'applied' },
      })
      const { container } = render(
        <WriteToolView
          {...createToolViewProps({
            toolName: operation.name,
            block,
            t,
            useDisclosure: mockUseDisclosure(expanded),
          })}
        />,
      )
      expect(container.textContent).toContain(t(operation.title))
      expect(container.textContent).toContain(t(operation.summary, operation.params))
      cleanup()
    }
  })

  it.each([
    [2, 0, 'applied'],
    [1, 2, 'partial'],
    [0, 3, 'failed'],
  ] as const)('reports %s restored and %s failed', (restored, failed, tone) => {
    const t = makeTranslate(dictionary)
    const block = settled({
      call: { name: 'zotero_restore_items', argsRaw: '{"refs":["requested"]}' },
      meta: { kind: 'restored', restoredCount: restored, failedCount: failed },
    })
    const { container } = render(
      <WriteToolView {...createToolViewProps({ toolName: 'zotero_restore_items', block, t })} />,
    )
    expect(container.textContent).toContain(t('toolTitleRestoreItems'))
    expect(container.textContent).toContain(
      t('toolSummaryRestoreItemsOutcome', { restored, alreadyPresent: 0, failed, unverified: 0 }),
    )
    expect(container.querySelector(`[data-state="${tone}"]`)).not.toBeNull()
    if (failed > 0) expect(container.querySelector('[data-tone="success"]')).toBeNull()
  })
})
