/**
 * The `zotero_export` tool surface: citation pairing and caller ordering,
 * style and locale pass-through, verbatim bibliography text, bibtex
 * itemization, and the ref-cap and blank-argument validations.
 * @module tests/tools/export
 */

import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  JOBS_UNAVAILABLE_MESSAGE,
  RUN_IN_BACKGROUND_DISABLED_MESSAGE,
  jobPromotedMessage,
  jobStartedMessage,
} from '../../src/job-runner.js'
import { TestJobRegistry } from '../helpers/fake-jobs.js'
import { expectValue, setupHostLane, type HostLane } from '../helpers/lanes/host-lane.js'
import { citationRow } from '../helpers/server/objects.js'

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

describe('zotero_export jobs', () => {
  describe('background jobs and promotion', () => {
    it('declares the run_in_background parameter statically regardless of composition', async () => {
      const defaultTool = lane.tool('zotero_export')!
      const defaultProps = (defaultTool.parameters as { properties?: Record<string, unknown> })
        .properties
      expect(defaultProps?.run_in_background).toBeDefined()
    })

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
        resultSessionId: 'test-session',
        jobId: 'zotero-1',
      })
      expect((result.content[0] as { text: string }).text).toBe(jobStartedMessage('zotero-1'))

      const job = jobRegistry.jobs.get('zotero-1' as never)!
      const outcome = await job.hooks.done
      expect(outcome.status).toBe('completed')
      expect(outcome.result).toContain('full result persisted')

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
        resultSessionId: 'test-session',
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

    it('writes export to outputFile and emits deliverables/presented event', async () => {
      lane.mock.route('GET', '/api/users/0/items', (req, res, helpers) =>
        helpers.text('@article{A2023,\n  title={Paper A}\n}'),
      )
      const appendedEvents: Array<{ type: string; data: unknown }> = []
      const fakeSession = {
        header: { id: 'session-deliv', cwd: '/workspace' },
        append: (type: string, data: unknown) => {
          appendedEvents.push({ type, data })
        },
      }
      lane.ctx.provide('workingDirectory', { ensure: async () => '/workspace' } as never)
      lane.ctx.provide('agents', { turnBoundaryOf: () => ({ lastTurn: 3 }) } as never)
      const writtenFiles: Record<string, string> = {}
      lane.ctx.provide('fs', {
        resolve: async (path: string, opts?: { cwd?: string }) => ({
          targetKey: `key:${path}`,
          displayPath: path.startsWith('/') ? path : `${opts?.cwd ?? ''}/${path}`,
        }),
        writeText: async (target: { displayPath: string }, content: string) => {
          writtenFiles[target.displayPath] = content
        },
        processPath: (target: { displayPath: string }) => target.displayPath,
      } as never)

      const batch = await lane.ctx.tools.execute({
        calls: [
          {
            type: 'tool-call',
            id: ToolCallId('tool-deliv'),
            name: 'zotero_export',
            arguments: JSON.stringify({
              refs: ['zotero://user/0/item/ABCD1234'],
              format: 'bibtex',
              outputFile: 'references.bib',
            }),
          },
        ],
        signal: new AbortController().signal,
        agent: { session: fakeSession } as never,
      })
      const result = expectValue(batch.results[0]!.result, 'zotero_export')

      expect(writtenFiles['/workspace/references.bib']).toContain('@article{A2023')
      expect(result.value).toMatchObject({
        format: 'bibtex',
        outputFile: '/workspace/references.bib',
        delivered: true,
      })
      expect(appendedEvents).toHaveLength(1)
      expect(appendedEvents[0].type).toBe('deliverables/presented')
      expect(appendedEvents[0].data).toMatchObject({
        turn: 3,
        callId: 'tool-deliv',
        files: [{ path: '/workspace/references.bib', description: 'Exported bibtex' }],
      })
    })

    it('exports references in CSV format', async () => {
      const mockCsv = '"Key","Item Type","Title"\n"ABCD1234","journalArticle","A Study"\n'
      mock.route('GET', '/api/users/0/items', (_req, _res, helpers, search) => {
        if (search.get('format') === 'csv') {
          return helpers.text(mockCsv)
        }
        return helpers.raw(400, {}, '')
      })

      const result = expectValue(
        await runTool('zotero_export', {
          refs: ['zotero://user/0/item/ABCD1234'],
          format: 'csv',
        }),
        'zotero_export',
      )
      expect(result.value).toEqual({
        format: 'csv',
        text: mockCsv,
      })
    })
  })
})
