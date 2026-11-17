/** Unknown optional keys fail before reads, approvals, or external retrieval. */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ZOTERO_TOOL_NAMES } from '../../src/constants.js'
import ScholarlyService from '../../src/scholarly/index.js'
import { SCHOLARLY_TOOL_NAMES } from '../../src/scholarly/types.js'
import { setupHostLane, type HostLane } from '../helpers/lanes/host-lane.js'
import {
  approvalAsks,
  resetApprovalStub,
  StubApproval,
  ApprovingQuestions,
} from '../helpers/approval-stub.js'

let lane: HostLane
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
  await lane.ctx.plugin(ScholarlyService, {})
})
afterEach(async () => {
  await lane.teardown()
})

describe('plugin tool parameter closure', () => {
  it('advertises closed root parameters for all thirty actual registrations', () => {
    for (const name of [...ZOTERO_TOOL_NAMES, ...SCHOLARLY_TOOL_NAMES])
      expect(lane.tool(name)?.parameters, name).toHaveProperty('additionalProperties', false)
  })

  it.each([
    ['zotero_search', { query: 'attention', excludeTag: ['archived'] }, 'excludeTag'],
    [
      'zotero_retrieve',
      { ref: 'zotero://user/0/item/AAAA1111', query: 'attention', attachmentPolicies: 'best' },
      'attachmentPolicies',
    ],
    [
      'zotero_export',
      { refs: ['zotero://user/0/item/AAAA1111'], format: 'citation', runInBackground: true },
      'runInBackground',
    ],
    [
      'zotero_create_item',
      { itemType: 'book', title: 'Study', publication_title: 'Journal' },
      'publication_title',
    ],
    ['scholarly_search', { query: 'attention', maxResults: 10 }, 'maxResults'],
  ])('refuses an unknown optional key for %s before side effects', async (name, args, key) => {
    const result = await lane.runTool(name, args)
    expect(result.isError).toBe(true)
    if (!result.isError) throw new Error('Expected unknown parameter refusal')
    expect(result.error.info).toMatchObject({ name: 'ToolArgsError', code: 'INVALID_ARGS' })
    expect((result.content[0] as { text: string }).text).toContain(
      `"${key}" is not a declared property`,
    )
    expect(lane.mock.requests).toEqual([])
    expect(approvalAsks).toEqual([])
    expect((lane.ctx.get('userQuestions') as unknown as ApprovingQuestions).asks).toEqual([])
  })

  it('still applies native nested validation to declared parameter names', async () => {
    const result = await lane.runTool('zotero_search', {
      library: { type: 'user', id: 0, unexpected: true },
      query: 'attention',
    })
    expect(result.isError).toBe(true)
    if (!result.isError) throw new Error('Expected native nested validation')
    expect(result.error.info).toMatchObject({ name: 'ToolArgsError', code: 'INVALID_ARGS' })
    expect(lane.mock.requests).toEqual([])
  })
})
