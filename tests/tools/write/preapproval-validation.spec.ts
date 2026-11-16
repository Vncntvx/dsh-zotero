/** Invalid mutations stop before both approval channels and Local API I/O. */
import { describe, expect, it } from 'vitest'
import {
  approvalAsks,
  ApprovingQuestions,
  resetApprovalStub,
  StubApproval,
} from '../../helpers/approval-stub.ts'
import { setupHostLane } from '../../helpers/lanes/host-lane.ts'

const cases: Array<[string, Record<string, unknown>]> = [
  ['zotero_create_saved_search', { name: 'Valid name', conditions: [] }],
  ['zotero_update_saved_search', { search: 'zotero://user/0/search/SEARCH01' }],
  ['zotero_update_collection', { collection: 'zotero://user/0/collection/COLLECT1' }],
  ['zotero_update_collection', { collection: 'zotero://user/0/collection/COLLECT1', name: '  ' }],
  ['zotero_restore_items', { refs: [] }],
]

describe('write preapproval validation', () => {
  it.each(cases)('%s rejects an empty mutation without asking the user', async (name, args) => {
    resetApprovalStub()
    let questions: ApprovingQuestions | undefined
    const lane = await setupHostLane(
      { writeEnabled: true },
      {
        compose: async (ctx) => {
          await ctx.plugin(StubApproval)
          await ctx.plugin(ApprovingQuestions)
          const service = ctx.get('userQuestions')
          if (!(service instanceof ApprovingQuestions)) throw new Error('Question stub is absent')
          questions = service
        },
      },
    )
    try {
      const result = await lane.runTool(name, args)
      expect(result.isError).toBe(true)
      expect(approvalAsks).toEqual([])
      expect(questions!.asks).toEqual([])
      expect(lane.mock.requests).toEqual([])
    } finally {
      await lane.teardown()
      resetApprovalStub()
    }
  })
})
