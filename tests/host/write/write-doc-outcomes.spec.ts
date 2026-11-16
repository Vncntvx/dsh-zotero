/** Registered write outcomes and descriptions remain visible in both public tool guides. */
import { readFile } from 'node:fs/promises'
import { afterEach, expect, it } from 'vitest'
import { ZOTERO_WRITE_TOOL_NAMES } from '../../../src/constants.js'
import { asRecord } from '../../../src/json.js'
import { setupHostLane, type HostLane } from '../../helpers/lanes/host-lane.js'

let lane: HostLane | undefined
afterEach(async () => {
  await lane?.teardown()
  lane = undefined
})

function outcomeKinds(schema: unknown): string[] {
  const record = asRecord(schema)!
  const variants = Array.isArray(record.oneOf) ? record.oneOf : [record]
  return variants.flatMap((variant) => {
    const kind = asRecord(asRecord(asRecord(variant)?.properties)?.kind)
    return Array.isArray(kind?.enum)
      ? kind.enum.filter((value): value is string => typeof value === 'string')
      : []
  })
}

it('documents every top-level outcome declared by every registered write tool', async () => {
  lane = await setupHostLane({ writeEnabled: true })
  const guides = await Promise.all(
    ['tools.md', 'tools.en.md'].map((file) =>
      readFile(new URL(`../../../docs/${file}`, import.meta.url), 'utf8'),
    ),
  )
  for (const name of ZOTERO_WRITE_TOOL_NAMES) {
    const tool = lane.tool(name)!
    expect(tool.description, name).toContain('do not retry')
    const kinds = outcomeKinds(tool.output.schema)
    expect(kinds.length, name).toBeGreaterThan(0)
    for (const guide of guides) {
      const section = guide.split(`## ${name}\n`)[1]!.split('\n## ')[0]!
      for (const kind of kinds) expect(section, `${name}: ${kind}`).toContain(`kind: "${kind}"`)
    }
  }
})
