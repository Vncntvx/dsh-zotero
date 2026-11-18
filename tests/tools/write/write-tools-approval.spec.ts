import { describe, expect, it } from 'vitest'

import { expectValue } from '../../helpers/lanes/host-lane.js'

import { WRITE_PLAN_QUESTION_ID } from '../../../src/write-approval.js'
import { ZOTERO_WRITE_TOOL_NAMES } from '../../../src/constants.js'

import { NEW_KEY, ScriptedQuestions, bootLane, serveWrites } from './support/write-tools.js'

describe('registration gating', () => {
  it('keeps every write tool off the surface until writeEnabled is set', async () => {
    expect(ZOTERO_WRITE_TOOL_NAMES).toHaveLength(15)
    const off = await bootLane({})
    for (const name of ZOTERO_WRITE_TOOL_NAMES) expect(off.tool(name)).toBeUndefined()
    await off.teardown()
    const on = await bootLane({ writeEnabled: true })
    for (const name of ZOTERO_WRITE_TOOL_NAMES) expect(on.tool(name)?.name).toBe(name)
    // The read surface stays mounted either way.
    expect(on.tool('zotero_search')?.name).toBe('zotero_search')
    await on.teardown()
  })
})

describe('write plan approval', () => {
  it('locates approval by WRITE_PLAN_QUESTION_ID even if other answers precede it', async () => {
    const lane = await bootLane({ writeEnabled: true })
    serveWrites(lane.mock)
    ScriptedQuestions.customAnswers = {
      answers: [
        { id: 'preceding_survey_question', selected: ['Reject'] },
        { id: WRITE_PLAN_QUESTION_ID, selected: ['Apply'] },
      ],
    }
    const result = expectValue(
      await lane.runTool('zotero_create_note', { markdown: 'x' }),
      'zotero_create_note',
    )
    expect(result.value).toMatchObject({ kind: 'applied', key: NEW_KEY })
  })

  it('treats approval response with custom text feedback as declined', async () => {
    const lane = await bootLane({ writeEnabled: true })
    serveWrites(lane.mock)
    ScriptedQuestions.customAnswers = {
      answers: [
        {
          id: WRITE_PLAN_QUESTION_ID,
          selected: [],
          custom: 'Please change the note content',
        },
      ],
    }
    const result = expectValue(
      await lane.runTool('zotero_create_note', { markdown: 'x' }),
      'zotero_create_note',
    )
    expect(result.value).toEqual({ kind: 'declined', feedback: 'Please change the note content' })
    expect(result.content).toContainEqual({
      type: 'text',
      text: 'User feedback:\nPlease change the note content',
    })
    expect(lane.mock.requests.some((request) => request.method === 'POST')).toBe(false)
  })
})
