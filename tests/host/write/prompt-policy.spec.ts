import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { setupHostLane, type HostLane } from '../../helpers/lanes/host-lane.js'
import { ZOTERO_WRITE_TOOL_NAMES } from '../../../src/constants.js'
import { WRITE_DISABLED_SENTENCE, WRITE_POLICY_SENTENCE } from '../../../src/prompt.js'

let lane: HostLane | undefined

beforeEach(() => {
  lane = undefined
})

afterEach(async () => {
  if (lane !== undefined) await lane.teardown()
  lane = undefined
})

describe('the write policy prompt section', () => {
  it('states the write policy in the prompt only while writes are enabled', async () => {
    const on = await setupHostLane({ writeEnabled: true })
    const assembly = await on.ctx.systemPrompt.assemble()
    const section = assembly.sections.find((entry) => entry.name === 'zotero:policy')
    expect(section?.text).toContain(WRITE_POLICY_SENTENCE)
    expect(section?.text).not.toContain(WRITE_DISABLED_SENTENCE)
    await on.teardown()
    const off = await setupHostLane({})
    const offAssembly = await off.ctx.systemPrompt.assemble()
    const offSection = offAssembly.sections.find((entry) => entry.name === 'zotero:policy')
    expect(offSection?.text).not.toContain(WRITE_POLICY_SENTENCE)
    await off.teardown()
  })

  it('says writes are off, and forbids the out-of-band routes, while the capability is disabled', async () => {
    const off = await setupHostLane({})
    const assembly = await off.ctx.systemPrompt.assemble()
    const section = assembly.sections.find((entry) => entry.name === 'zotero:policy')
    const text = section?.text ?? ''
    // The disabled state is stated, with the way to turn it on and the routes
    // that stay out of bounds even when the user asks for the change directly.
    expect(text).toContain(WRITE_DISABLED_SENTENCE)
    expect(text).toContain('writeEnabled')
    expect(text).toContain('do not call the Zotero local API yourself')
    expect(text).toContain('out of bounds even when the user asks for the change directly')
    await off.teardown()
  })

  it('keeps the model on the sanctioned path and off the verification read while writes are enabled', async () => {
    const on = await setupHostLane({ writeEnabled: true })
    const assembly = await on.ctx.systemPrompt.assemble()
    const section = assembly.sections.find((entry) => entry.name === 'zotero:policy')
    const text = section?.text ?? ''
    expect(text).toContain('Write only through these tools')
    expect(text).toContain('never ask for or reuse a local-API authorization key')
    expect(text).toContain('report only what it proves and do not re-read to verify it')
    // Every write tool the sanctioned path names, and nothing retired.
    for (const name of ZOTERO_WRITE_TOOL_NAMES) expect(text).toContain(name)
    expect(ZOTERO_WRITE_TOOL_NAMES).toHaveLength(15)
    await on.teardown()
  })
})
