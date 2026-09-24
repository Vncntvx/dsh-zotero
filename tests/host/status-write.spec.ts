import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CommandId } from '@deepseek-ai/dsh-commands'
import type { CommandInvocation } from '@deepseek-ai/dsh-commands'
import { setupHostLane, type HostLane } from '../helpers/lanes/host-lane.js'
import { WRITE_POLICY_SENTENCE } from '../../src/prompt.js'

let lane: HostLane | undefined

beforeEach(() => {
  lane = undefined
})

afterEach(async () => {
  if (lane !== undefined) await lane.teardown()
  lane = undefined
})

describe('the write state across the status surfaces', () => {
  it('reports the write line on /zotero status while no key is stored yet', async () => {
    lane = await setupHostLane({ writeEnabled: true }, { commands: true })
    lane.mock.route('GET', '/api/', (_req, res, helpers) =>
      helpers.json({}, { 'Zotero-Server-ID': 'srv-status-write1', 'X-Zotero-Version': '10.0.2' }),
    )
    const definition = lane.stub!.registered[0]!
    const result = (await definition.handler(invocation('status'))) as {
      kind: string
      text?: string
    }
    expect(result.kind).toBe('success')
    expect(result.text).toContain('Write: enabled (no key yet)')
  })

  it('states the write policy in the prompt only while writes are enabled', async () => {
    const on = await setupHostLane({ writeEnabled: true })
    const assembly = await on.ctx.systemPrompt.assemble()
    const section = assembly.sections.find((entry) => entry.name === 'zotero:policy')
    expect(section?.text).toContain(WRITE_POLICY_SENTENCE)
    await on.teardown()
    const off = await setupHostLane({})
    const offAssembly = await off.ctx.systemPrompt.assemble()
    const offSection = offAssembly.sections.find((entry) => entry.name === 'zotero:policy')
    expect(offSection?.text).not.toContain(WRITE_POLICY_SENTENCE)
    await off.teardown()
  })
})

function invocation(command: string): CommandInvocation {
  return {
    commandId: CommandId('test-command'),
    agent: {} as never,
    rawInput: command,
    signal: new AbortController().signal,
    attachments: [],
  }
}
