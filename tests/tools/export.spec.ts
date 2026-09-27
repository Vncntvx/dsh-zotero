/**
 * The `zotero_export` tool surface: citation pairing and caller ordering,
 * style and locale pass-through, verbatim bibliography text, bibtex
 * itemization, and the ref-cap and blank-argument validations.
 * @module tests/tools/export
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { invalidRefMessage } from '../../src/refs.js'
import {
  EXPORT_LOCALE_BLANK_MESSAGE,
  EXPORT_REFS_EMPTY_MESSAGE,
  EXPORT_STYLE_BLANK_MESSAGE,
  exportRefsOverCapMessage,
} from '../../src/tools/export.js'
import {
  JOBS_UNAVAILABLE_MESSAGE,
  RUN_IN_BACKGROUND_DISABLED_MESSAGE,
  jobStartedMessage,
  jobPromotedMessage,
} from '../../src/job-runner.js'
import { expectValue, type HostLane, setupHostLane } from '../helpers/lanes/host-lane.js'
import { citationRow } from '../helpers/server/objects.js'
import { TestJobRegistry } from '../helpers/fake-jobs.js'

let lane: HostLane
let mock: HostLane['mock']
let runTool: HostLane['runTool']

beforeEach(async () => {
  lane = await setupHostLane()
  mock = lane.mock
  runTool = lane.runTool
})

afterEach(async () => {
  await lane.teardown()
})

describe('zotero_export tool', () => {
  it('registers and exposes its schema to the assembly', () => {
    expect(lane.tool('zotero_export')).toBeDefined()
    expect(lane.ctx.tools.schemas().some((schema) => schema.name === 'zotero_export')).toBe(true)
  })

  it('exports paired citations ordered as requested', async () => {
    mock.route('GET', '/api/users/0/items', (req, res, helpers) =>
      helpers.json([
        citationRow('BBBB1234', '<span>B, 2021</span>'),
        citationRow('ABCD1234', '<span>A, 2023</span>'),
      ]),
    )
    const result = expectValue(
      await runTool('zotero_export', {
        refs: ['zotero://user/0/item/ABCD1234', 'zotero://user/0/item/BBBB1234'],
        format: 'citation',
      }),
      'zotero_export',
    )
    expect(result.value).toEqual({
      format: 'citation',
      style: 'apa',
      locale: 'en-US',
      citations: [
        { ref: 'zotero://user/0/item/ABCD1234', text: '<span>A, 2023</span>' },
        { ref: 'zotero://user/0/item/BBBB1234', text: '<span>B, 2021</span>' },
      ],
    })
    expect((result.content[0] as { text: string }).text).toBe(
      [
        'zotero://user/0/item/ABCD1234: <span>A, 2023</span>',
        'zotero://user/0/item/BBBB1234: <span>B, 2021</span>',
      ].join('\n'),
    )
  })

  it('passes explicit style and locale through to the export', async () => {
    mock.route('GET', '/api/users/0/items', (req, res, helpers) =>
      helpers.json([citationRow('ABCD1234', 'x')]),
    )
    const result = expectValue(
      await runTool('zotero_export', {
        refs: ['zotero://user/0/item/ABCD1234'],
        format: 'citation',
        style: 'chicago-note-bibliography',
        locale: 'de-DE',
      }),
      'zotero_export',
    )
    expect(mock.requests[0]!.search.get('style')).toBe('chicago-note-bibliography')
    expect(mock.requests[0]!.search.get('locale')).toBe('de-DE')
    expect(result.value).toEqual({
      format: 'citation',
      style: 'chicago-note-bibliography',
      locale: 'de-DE',
      citations: [{ ref: 'zotero://user/0/item/ABCD1234', text: 'x' }],
    })
  })

  it('renders opaque bibliography text verbatim', async () => {
    mock.route('GET', '/api/users/0/items', (req, res, helpers) => helpers.text('entry-a\nentry-b'))
    const result = expectValue(
      await runTool('zotero_export', {
        refs: ['zotero://user/0/item/ABCD1234'],
        format: 'bibliography',
      }),
      'zotero_export',
    )
    expect((result.content[0] as { text: string }).text).toBe('entry-a\nentry-b')
  })

  it('itemizes each translator document with its batch citation key and title', async () => {
    const batchText =
      '@article{batchPan2022,\n  title = {Carbon price forecasting},\n}\n\n' +
      '@article{batchZheng2025,\n  title = {Insight into heterogeneous risks},\n}\n'
    const secondStart = batchText.indexOf('@article{batchZheng2025,')
    mock.route('GET', '/api/users/0/items', (req, res, helpers, search) => {
      const keys = (search.get('itemKey') ?? '').split(',')
      if (keys.length > 1) {
        helpers.text(batchText)
        return
      }
      // The single-item context generates different citation keys; the
      // mapping pairs the entries by content regardless.
      helpers.text(
        keys[0] === 'ABCD1234'
          ? '@article{singlePan2022,\n  title = {Carbon price forecasting},\n}\n'
          : '@article{singleZheng2025,\n  title = {Insight into heterogeneous risks},\n}\n',
      )
    })
    const result = expectValue(
      await runTool('zotero_export', {
        refs: ['zotero://user/0/item/ABCD1234', 'zotero://user/0/item/BBBB1234'],
        format: 'bibtex',
      }),
      'zotero_export',
    )
    expect(result.value).toEqual({
      format: 'bibtex',
      text: batchText,
      items: [
        {
          ref: 'zotero://user/0/item/ABCD1234',
          key: 'batchPan2022',
          title: 'Carbon price forecasting',
          start: 0,
          end: secondStart,
        },
        {
          ref: 'zotero://user/0/item/BBBB1234',
          key: 'batchZheng2025',
          title: 'Insight into heterogeneous risks',
          start: secondStart,
          end: batchText.length,
        },
      ],
    })
    // The model-visible render stays the merged body, not the itemization.
    expect((result.content[0] as { text: string }).text).toBe(batchText)
  })

  it('rejects empty ref lists, malformed refs, and blank styles before any request', async () => {
    const empty = await runTool('zotero_export', { refs: [], format: 'bibtex' })
    expect(empty.isError).toBe(true)
    if (!empty.isError) throw new Error('unreachable')
    expect((empty.content[0] as { text: string }).text).toContain(EXPORT_REFS_EMPTY_MESSAGE)

    const malformed = await runTool('zotero_export', { refs: ['nope'], format: 'bibtex' })
    expect(malformed.isError).toBe(true)
    if (!malformed.isError) throw new Error('unreachable')
    expect((malformed.content[0] as { text: string }).text).toContain(invalidRefMessage('nope'))

    const blankStyle = await runTool('zotero_export', {
      refs: ['zotero://user/0/item/ABCD1234'],
      format: 'citation',
      style: '  ',
    })
    expect(blankStyle.isError).toBe(true)
    if (!blankStyle.isError) throw new Error('unreachable')
    expect((blankStyle.content[0] as { text: string }).text).toContain(EXPORT_STYLE_BLANK_MESSAGE)

    const blankLocale = await runTool('zotero_export', {
      refs: ['zotero://user/0/item/ABCD1234'],
      format: 'citation',
      locale: '  ',
    })
    expect(blankLocale.isError).toBe(true)
    if (!blankLocale.isError) throw new Error('unreachable')
    expect((blankLocale.content[0] as { text: string }).text).toContain(EXPORT_LOCALE_BLANK_MESSAGE)

    expect(mock.requests).toEqual([])
  })

  it('rejects ref lists above the configured export cap before any request', async () => {
    const refs = Array.from(
      { length: 1001 },
      (_, i) => `zotero://user/0/item/${String(i).padStart(4, '0')}ABCD`,
    )
    const result = await runTool('zotero_export', { refs, format: 'bibtex' })
    expect(result.isError).toBe(true)
    if (!result.isError) throw new Error('unreachable')
    expect((result.content[0] as { text: string }).text).toContain(
      exportRefsOverCapMessage(50, 1001),
    )
    expect(mock.requests).toEqual([])
  })

  it('accepts exactly the capped ref count', async () => {
    const refs = Array.from(
      { length: 50 },
      (_, i) => `zotero://user/0/item/${String(i).padStart(4, '0')}ABCD`,
    )
    mock.route('GET', '/api/users/0/items', (req, res, helpers, search) =>
      helpers.json((search.get('itemKey') ?? '').split(',').map((key) => citationRow(key, 'x'))),
    )
    const result = expectValue(
      await runTool('zotero_export', { refs, format: 'citation' }),
      'zotero_export',
    )
    expect((result.value as { citations: unknown[] }).citations).toHaveLength(50)
  })

  it('declares itself concurrency-safe for valid arguments', () => {
    expect(
      lane
        .tool('zotero_export')!
        .isConcurrencySafe?.({ refs: ['zotero://user/0/item/ABCD1234'], format: 'bibtex' }),
    ).toBe(true)
  })

  describe('background jobs and promotion', () => {
    it('refuses run_in_background when enableRunInBackground is disabled in config', async () => {
      await lane.teardown()
      lane = await setupHostLane({ enableRunInBackground: false })
      runTool = lane.runTool

      const result = await runTool('zotero_export', {
        refs: ['zotero://user/0/item/ABCD1234'],
        format: 'citation',
        run_in_background: true,
      })
      expect(result.isError).toBe(true)
      if (!result.isError) throw new Error('unreachable')
      expect((result.content[0] as { text: string }).text).toBe(
        `Error: ${RUN_IN_BACKGROUND_DISABLED_MESSAGE}`,
      )
    })

    it('refuses run_in_background when ctx.jobs service is unavailable', async () => {
      const result = await runTool('zotero_export', {
        refs: ['zotero://user/0/item/ABCD1234'],
        format: 'citation',
        run_in_background: true,
      })
      expect(result.isError).toBe(true)
      if (!result.isError) throw new Error('unreachable')
      expect((result.content[0] as { text: string }).text).toBe(
        `Error: ${JOBS_UNAVAILABLE_MESSAGE}`,
      )
    })

    it('starts a background job and returns immediately when run_in_background is requested', async () => {
      let jobRegistry!: TestJobRegistry
      await lane.teardown()
      lane = await setupHostLane(
        {},
        {
          compose: async (ctx) => {
            jobRegistry = new TestJobRegistry(ctx)
          },
        },
      )
      runTool = lane.runTool
      lane.mock.route('GET', '/api/users/0/items', (req, res, helpers) =>
        helpers.json([citationRow('ABCD1234', '<span>A, 2023</span>')]),
      )

      const result = expectValue(
        await runTool('zotero_export', {
          refs: ['zotero://user/0/item/ABCD1234'],
          format: 'citation',
          run_in_background: true,
        }),
        'zotero_export',
      )

      expect(result.value).toEqual({
        kind: 'background',
        jobId: 'zotero-1',
      })
      expect((result.content[0] as { text: string }).text).toBe(jobStartedMessage('zotero-1'))

      const job = jobRegistry.jobs.get('zotero-1' as never)!
      const outcome = await job.hooks.done
      expect(outcome.status).toBe('completed')
      expect(outcome.result).toContain('zotero://user/0/item/ABCD1234')

      const toolDef = lane.tool('zotero_export')!
      const view = toolDef.presentResult?.(
        { refs: ['zotero://user/0/item/ABCD1234'], format: 'citation' },
        result as never,
      )
      expect(view?.title).toBe('Zotero export: background job zotero-1')
    })

    it('promotes to a background job when execution exceeds foregroundWaitMs', async () => {
      await lane.teardown()
      lane = await setupHostLane(
        { foregroundWaitMs: 20 },
        {
          compose: async (ctx) => {
            await ctx.plugin(TestJobRegistry)
          },
        },
      )
      runTool = lane.runTool
      lane.mock.route('GET', '/api/users/0/items', async (req, res, helpers) => {
        await new Promise((resolve) => setTimeout(resolve, 100))
        return helpers.json([citationRow('ABCD1234', '<span>A, 2023</span>')])
      })

      const result = expectValue(
        await runTool('zotero_export', {
          refs: ['zotero://user/0/item/ABCD1234'],
          format: 'citation',
        }),
        'zotero_export',
      )

      expect(result.value).toEqual({
        kind: 'promoted',
        jobId: 'zotero-1',
        timeoutMs: 20,
        message: jobPromotedMessage('zotero-1', 20),
      })
      expect((result.content[0] as { text: string }).text).toBe(jobPromotedMessage('zotero-1', 20))

      const toolDef = lane.tool('zotero_export')!
      const view = toolDef.presentResult?.(
        { refs: ['zotero://user/0/item/ABCD1234'], format: 'citation' },
        result as never,
      )
      expect(view?.title).toBe('Zotero export: promoted to job zotero-1')
    })

    it('returns the foreground result when execution completes within foregroundWaitMs', async () => {
      await lane.teardown()
      lane = await setupHostLane(
        { foregroundWaitMs: 1000 },
        {
          compose: async (ctx) => {
            await ctx.plugin(TestJobRegistry)
          },
        },
      )
      runTool = lane.runTool
      lane.mock.route('GET', '/api/users/0/items', (req, res, helpers) =>
        helpers.json([citationRow('ABCD1234', '<span>A, 2023</span>')]),
      )

      const result = expectValue(
        await runTool('zotero_export', {
          refs: ['zotero://user/0/item/ABCD1234'],
          format: 'citation',
        }),
        'zotero_export',
      )

      expect(result.value).toEqual({
        format: 'citation',
        style: 'apa',
        locale: 'en-US',
        citations: [{ ref: 'zotero://user/0/item/ABCD1234', text: '<span>A, 2023</span>' }],
      })
    })
  })
})
