import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CommandId } from '@deepseek-ai/dsh-commands'
import type { CommandInvocation } from '@deepseek-ai/dsh-commands'
import { setupHostLane, type HostLane } from '../helpers/lanes/host-lane.js'
import { formatStatus } from '../../src/command.js'
import { WRITE_POLICY_SENTENCE } from '../../src/prompt.js'
import type { ZoteroStatus } from '../../src/types.js'

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

describe('formatStatus write line', () => {
  const connected: ZoteroStatus = {
    providerId: 'local',
    connected: true,
    diagnosis: 'ok',
    zoteroVersion: '10.0.2',
  }

  it('reports disabled when write.enabled is false, regardless of authorization', () => {
    const text = formatStatus({
      ...connected,
      write: { enabled: false, authorized: true },
    })
    expect(text).toContain('Write: disabled')
    expect(text).not.toContain('key stored')
    expect(text).not.toContain('no key yet')
  })

  it('reports the authorization state only while write.enabled is true', () => {
    expect(formatStatus({ ...connected, write: { enabled: true, authorized: true } })).toContain(
      'Write: enabled (key stored)',
    )
    expect(formatStatus({ ...connected, write: { enabled: true, authorized: false } })).toContain(
      'Write: enabled (no key yet)',
    )
  })

  it('omits the write line when the provider serves no writes', () => {
    expect(formatStatus(connected)).not.toContain('Write:')
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
