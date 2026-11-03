import { afterEach, describe, expect, it } from 'vitest'
import { ZOTERO_TOOL_NAMES } from '../../src/constants.js'
import { ZOTERO_READ_ROUTING_SENTENCE, WRITE_POLICY_SENTENCE } from '../../src/prompt.js'
import { SCHOLARLY_ROUTE_SENTENCE, SCHOLARLY_TOOL_ROUTING } from '../../src/scholarly/prompt.js'
import ScholarlyService from '../../src/scholarly/index.js'
import { setupHostLane, type HostLane } from '../helpers/lanes/host-lane.js'
import { bootScholarlyContext } from '../scholarly/fixtures.js'

let lane: HostLane | undefined

afterEach(async () => {
  await lane?.teardown()
  lane = undefined
})

describe('tool surface and prompt budgets', () => {
  it('keeps local and combined tool definitions within their UTF-8 budgets', async () => {
    lane = await setupHostLane({ writeEnabled: true })
    const coreSchemas = lane.ctx.tools.schemas()
    expect(coreSchemas.map((schema) => schema.name).sort()).toEqual([...ZOTERO_TOOL_NAMES].sort())
    const coreBytes = Buffer.byteLength(JSON.stringify(coreSchemas), 'utf8')
    const breakdown = coreSchemas
      .map((schema) => `${schema.name}:${Buffer.byteLength(JSON.stringify(schema), 'utf8')}`)
      .sort((left, right) => Number(right.split(':')[1]) - Number(left.split(':')[1]))
      .slice(0, 8)
      .join(', ')
    expect(
      coreBytes,
      `core tool definitions: ${coreBytes} bytes (${breakdown})`,
    ).toBeLessThanOrEqual(34 * 1024)

    const scholarly = await bootScholarlyContext()
    const fiber = scholarly.plugin(ScholarlyService, {})
    await fiber
    const scholarlySchemas = scholarly.tools.schemas()
    const combinedBytes = coreBytes + Buffer.byteLength(JSON.stringify(scholarlySchemas), 'utf8')
    await scholarly.fiber.dispose()
    expect(
      combinedBytes,
      `core + scholarly tool definitions: ${combinedBytes} bytes`,
    ).toBeLessThanOrEqual(40 * 1024)
  })

  it('keeps reusable write policy and routing text within their budgets', () => {
    const writeBytes = Buffer.byteLength(WRITE_POLICY_SENTENCE, 'utf8')
    const routeBytes = Buffer.byteLength(
      ZOTERO_READ_ROUTING_SENTENCE + SCHOLARLY_TOOL_ROUTING + SCHOLARLY_ROUTE_SENTENCE,
      'utf8',
    )
    expect(writeBytes, `write policy: ${writeBytes} bytes`).toBeLessThanOrEqual(1400)
    expect(routeBytes, `read + scholarly routes: ${routeBytes} bytes`).toBeLessThanOrEqual(1200)
  })
})
