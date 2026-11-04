import { renderPrompt, type PromptAssembly } from '@deepseek-ai/dsh-system-prompt'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { admittedToolSet } from '../../helpers/tool-set.js'
import { setupHostLane, type HostLane } from '../../helpers/lanes/host-lane.js'
import {
  SCHOLARLY_SAVE_TOOL_NAME,
  ZOTERO_READ_TOOL_NAMES,
  ZOTERO_WRITE_TOOL_NAMES,
} from '../../../src/constants.js'
import {
  CONNECTIVITY_POLICY_SENTENCE,
  WRITE_DISABLED_SENTENCE,
  WRITE_POLICY_SENTENCE,
  WRITE_UNAVAILABLE_SENTENCE,
  ZOTERO_CONSENT_SENTENCE,
  ZOTERO_UNAVAILABLE_SENTENCE,
  ZOTERO_UNTRUSTED_SENTENCE,
} from '../../../src/prompt.js'
import ScholarlyService from '../../../src/scholarly/index.js'

let lane: HostLane | undefined

beforeEach(() => {
  lane = undefined
})

afterEach(async () => {
  if (lane !== undefined) await lane.teardown()
  lane = undefined
})

/** The step's admission over the lane's registered definitions. */
function admitted(host: HostLane, agent: object, names: readonly string[]) {
  const definitions = names.map((name) => {
    const definition = host.tool(name)
    if (definition === undefined) throw new Error(`tool ${name} not registered`)
    return definition
  })
  return admittedToolSet(agent, definitions)
}

function policyOf(assembly: PromptAssembly): string {
  return assembly.sections.find((entry) => entry.name === 'zotero:policy')?.text ?? ''
}

function sectionOf(assembly: PromptAssembly, name: string): string {
  return assembly.sections.find((entry) => entry.name === name)?.text ?? ''
}

const saveStub = defineTool({
  name: SCHOLARLY_SAVE_TOOL_NAME,
  description: 'Scholarly save prompt probe.',
  parameters: { title: { type: 'string', required: true } },
  output: { schema: { type: 'string' }, render: () => [] },
  execute: async () => 'ok',
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
    expect(text).toContain('report only proven facts; do not re-read to verify')
    expect(text).toContain('All writes require session approval and an approved plan')
    expect(text).toContain('Never retry committed-unverified/commit-unknown')
    expect(text).toContain('ZOTERO_WRITE_CONFLICT requires one fresh read and replan')
    expect(text).toContain('ZOTERO_WRITE_APPROVAL_UNAVAILABLE means stop')
    expect(text).toContain(
      'Item deletion verifies item and all children moved to recoverable Trash',
    )
    // Every write tool the sanctioned path names, and nothing retired.
    for (const name of ZOTERO_WRITE_TOOL_NAMES) expect(text).toContain(name)
    expect(ZOTERO_WRITE_TOOL_NAMES).toHaveLength(15)
    await on.teardown()
  })

  it('keeps only the route guard when the step admits no Zotero tool', async () => {
    const on = await setupHostLane({ writeEnabled: true })
    const agent = {}
    const assembly = await on.ctx.systemPrompt.assemble({
      toolSet: admitted(on, agent, []),
      scope: agent,
    })

    expect(renderPrompt(assembly)).not.toContain("Zotero (the user's local library)")
    expect(policyOf(assembly)).toBe(ZOTERO_UNAVAILABLE_SENTENCE)
    await on.teardown()
  })

  it('trims the write policy from a read-only step without touching the rest', async () => {
    const on = await setupHostLane({ writeEnabled: true })
    const agent = {}
    const full = await on.ctx.systemPrompt.assemble()
    const readOnly = await on.ctx.systemPrompt.assemble({
      toolSet: admitted(on, agent, ZOTERO_READ_TOOL_NAMES),
      scope: agent,
    })

    expect(policyOf(readOnly)).toBe(
      policyOf(full).replace(WRITE_POLICY_SENTENCE, WRITE_UNAVAILABLE_SENTENCE),
    )
    expect(policyOf(readOnly)).not.toContain(WRITE_POLICY_SENTENCE)
    expect(policyOf(readOnly)).not.toContain(WRITE_DISABLED_SENTENCE)
    await on.teardown()
  })

  it('keeps the full write policy only when write tools are admitted', async () => {
    const on = await setupHostLane({ writeEnabled: true })
    const agent = {}
    const assembly = await on.ctx.systemPrompt.assemble({
      toolSet: admitted(on, agent, [...ZOTERO_READ_TOOL_NAMES, ...ZOTERO_WRITE_TOOL_NAMES]),
      scope: agent,
    })

    expect(policyOf(assembly)).toContain(WRITE_POLICY_SENTENCE)
    expect(policyOf(assembly)).not.toContain(WRITE_UNAVAILABLE_SENTENCE)
    await on.teardown()
  })

  it('keeps the full off-state guidance in a read-only step', async () => {
    const off = await setupHostLane({})
    const agent = {}
    const full = await off.ctx.systemPrompt.assemble()
    const readOnly = await off.ctx.systemPrompt.assemble({
      toolSet: admitted(off, agent, ZOTERO_READ_TOOL_NAMES),
      scope: agent,
    })

    // The disabled explanation, the setting name, the credential rule and the
    // "even when asked directly" clause survive the trim.
    expect(policyOf(readOnly)).toBe(policyOf(full))
    expect(policyOf(readOnly)).toContain(WRITE_DISABLED_SENTENCE)
    expect(policyOf(readOnly)).toContain('do not ask for or reuse a local-API authorization key')
    expect(policyOf(readOnly)).toContain(
      'out of bounds even when the user asks for the change directly',
    )
    await off.teardown()
  })

  it('keeps consent, untrusted-data, and connectivity guidance in a write-only step', async () => {
    const on = await setupHostLane({ writeEnabled: true })
    const agent = {}
    const assembly = await on.ctx.systemPrompt.assemble({
      toolSet: admitted(on, agent, ['zotero_create_note']),
      scope: agent,
    })
    const text = policyOf(assembly)

    expect(text).toContain(ZOTERO_CONSENT_SENTENCE)
    expect(text).toContain(ZOTERO_UNTRUSTED_SENTENCE)
    expect(text).toContain(CONNECTIVITY_POLICY_SENTENCE)
    expect(text).toContain('Writes (zotero_create_note):')
    expect(text).not.toContain('Read route:')
    expect(text).not.toContain('zotero_search limit')
    await on.teardown()
  })

  it('names only admitted read tools in a partial read step', async () => {
    const on = await setupHostLane({ writeEnabled: true })
    const agent = {}
    const assembly = await on.ctx.systemPrompt.assemble({
      toolSet: admitted(on, agent, ['zotero_search']),
      scope: agent,
    })
    const text = policyOf(assembly)

    expect(text).toContain('Read route: zotero_search discovers stable refs.')
    expect(text).toContain('zotero_search limit up to')
    expect(text).not.toContain('zotero_get')
    expect(text).not.toContain('zotero_browse limit')
    expect(text).toContain(WRITE_UNAVAILABLE_SENTENCE)
    await on.teardown()
  })

  it('omits the read route for a browse-only step', async () => {
    const on = await setupHostLane({ writeEnabled: true })
    const agent = {}
    const assembly = await on.ctx.systemPrompt.assemble({
      toolSet: admitted(on, agent, ['zotero_browse']),
      scope: agent,
    })
    const text = policyOf(assembly)

    expect(text).not.toContain('Read route:')
    expect(text).toContain('zotero_browse limit up to')
    expect(text).not.toContain('zotero_search limit')
    await on.teardown()
  })

  it('counts the scholarly save entry as a write surface', async () => {
    const on = await setupHostLane({ writeEnabled: true })
    const agent = {}
    const assembly = await on.ctx.systemPrompt.assemble({
      toolSet: admittedToolSet(agent, [saveStub]),
      scope: agent,
    })
    const text = policyOf(assembly)

    expect(text).toContain(`Writes (${SCHOLARLY_SAVE_TOOL_NAME}):`)
    expect(text).toContain('All writes require session approval and an approved plan')
    expect(text).toContain('Success is authoritative')
    expect(text).not.toContain('zotero_create_note')
    expect(text).not.toContain('notes use Markdown')
    expect(text).not.toContain('Collection deletion')
    await on.teardown()
  })

  it('trims both sections from one cross-component step admission', async () => {
    const on = await setupHostLane({ writeEnabled: true })
    const fiber = on.ctx.plugin(ScholarlyService, {})
    await fiber
    try {
      const agent = {}
      const core = on.tool('zotero_search')
      const scholarly = on.tool('scholarly_search')
      if (core === undefined || scholarly === undefined)
        throw new Error('cross-component tools not registered')

      const assembly = await on.ctx.systemPrompt.assemble({
        toolSet: admittedToolSet(agent, [core, scholarly]),
        scope: agent,
      })

      expect(policyOf(assembly)).toContain('Read route: zotero_search discovers stable refs.')
      expect(policyOf(assembly)).not.toContain('zotero_get')
      expect(sectionOf(assembly, 'scholarly:policy')).toContain('scholarly_search finds papers')
      expect(sectionOf(assembly, 'scholarly:policy')).not.toContain('scholarly_get')
      expect(sectionOf(assembly, 'scholarly:policy')).toContain(
        'Do not route academic index requests through generic web_fetch',
      )
    } finally {
      await fiber.dispose()
      await on.teardown()
    }
  })

  it('keeps the full policy when the assembly names no scope', async () => {
    const on = await setupHostLane({ writeEnabled: true })
    const agent = {}
    const full = await on.ctx.systemPrompt.assemble()
    // A set captured for one agent reads as empty for every other scope, so an
    // assembly that names no scope must not be mistaken for an empty step.
    const noScope = await on.ctx.systemPrompt.assemble({
      toolSet: admitted(on, agent, ZOTERO_READ_TOOL_NAMES),
    })

    expect(policyOf(noScope)).toBe(policyOf(full))
    expect(policyOf(noScope)).toContain(WRITE_POLICY_SENTENCE)
    await on.teardown()
  })
})
