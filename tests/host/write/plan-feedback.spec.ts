/** A change request remains a refusal and reaches the model without loss. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { validateJsonSchemaValue } from '@deepseek-ai/dsh-tools'
import { ZOTERO_WRITE_TOOL_NAMES } from '../../../src/constants.js'
import { WRITE_PLAN_QUESTION_ID } from '../../../src/write-approval.js'
import { setupHostLane, type HostLane } from '../../helpers/lanes/host-lane.js'
import { ApprovingQuestions, StubApproval, resetApprovalStub } from '../../helpers/approval-stub.js'

let lane: HostLane
const feedback = '请把标题改为「新的研究标题」。\n保留 **完整正文** 和标签。'
beforeEach(async () => {
  resetApprovalStub()
  lane = await setupHostLane(
    { writeEnabled: true },
    {
      compose: async (ctx) => {
        await ctx.plugin(StubApproval)
        await ctx.plugin(ApprovingQuestions)
      },
    },
  )
})
afterEach(async () => {
  vi.restoreAllMocks()
  await lane.teardown()
})

describe('plan review feedback', () => {
  it.each([{ selected: ['Apply'] }, { selected: ['Cancel'] }, { selected: [] }])(
    'declines a custom response with $selected and returns its exact text',
    async ({ selected }) => {
      const questions = lane.ctx.get('userQuestions') as unknown as ApprovingQuestions
      vi.spyOn(questions, 'ask').mockResolvedValue({
        answers: [{ id: WRITE_PLAN_QUESTION_ID, selected, custom: feedback }],
      })
      const result = await lane.runTool('zotero_create_note', { markdown: 'Requested note' })
      expect(result.isError).toBe(false)
      expect(result.value).toEqual({ kind: 'declined', feedback })
      expect(result.meta).toEqual({ kind: 'declined', feedback })
      expect(result.content).toContainEqual({ type: 'text', text: `User feedback:\n${feedback}` })
      expect(lane.mock.requests).toEqual([])
    },
  )

  it('retains feedback in every registered local write output, model render and projection', () => {
    const value = { kind: 'declined', feedback }
    for (const name of ZOTERO_WRITE_TOOL_NAMES) {
      const tool = lane.tool(name)!
      expect(validateJsonSchemaValue(tool.output.schema, value, ''), name).toEqual([])
      expect(tool.output.render({}, value), name).toContainEqual({
        type: 'text',
        text: `User feedback:\n${feedback}`,
      })
      expect(tool.output.presentationMeta?.({}, value), name).toEqual(value)
    }
  })
})
