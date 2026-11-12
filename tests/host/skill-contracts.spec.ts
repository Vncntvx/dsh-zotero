/** Static SOP contract checks against both published tool docs and live schemas; no execution. */
import { readFileSync } from 'node:fs'
import { isSkillName } from '@deepseek-ai/dsh-skill'
import {
  validateJsonSchemaValue,
  type JsonSchemaNode,
  type ObjectJsonSchema,
} from '@deepseek-ai/dsh-tools'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { afterEach, describe, expect, it } from 'vitest'
import ScholarlyService from '../../src/scholarly/service.js'
import { CORE_SOPS } from '../../src/skills/core.js'
import {
  EXTERNAL_AUTHORIZATION_RULE,
  SOP_CONTRACT_RULES,
  recipesOf,
  skillRegistration,
  type ResearchSop,
} from '../../src/skills/definition.js'
import { SCHOLARLY_SOPS } from '../../src/skills/scholarly.js'
import { setupHostLane, type HostLane } from '../helpers/lanes/host-lane.js'

// This is a host-composition spec: use the host lane rather than scholarly support.
import { isCompositionDependent } from './support/composition-dependent-parameters.js'

const SOPS = [...CORE_SOPS, ...SCHOLARLY_SOPS]
let lane: HostLane | undefined
afterEach(async () => {
  await lane?.ctx.fiber.dispose()
  await lane?.teardown()
  lane = undefined
})

const CJK = /[\u3400-\u9fff]/

/** Every model-facing string of a SOP, not just the rendered body. */
function modelFacingText(sop: ResearchSop): string {
  return [
    sop.description,
    sop.whenToUse,
    ...sop.phases.map(({ instruction }) => instruction),
    ...sop.failureModes,
    sop.output,
    skillRegistration(sop).content,
  ].join('\n')
}

/**
 * Reject keys a schema never declares, independent of `additionalProperties`:
 * the compiled parameter schema is an open object at several levels, so the
 * value validator alone cannot catch a misspelled nested key.
 */
function undeclaredKeys(node: JsonSchemaNode, value: JsonValue, path: string): string[] {
  if (Array.isArray(value))
    return node.items
      ? value.flatMap((item, index) => undeclaredKeys(node.items!, item, `${path}[${index}]`))
      : []
  if (value === null || typeof value !== 'object') return []
  const branches: JsonSchemaNode[] = [node, ...(node.oneOf ?? [])]
  const declaring = (key: string) =>
    branches.find((branch) => branch.properties?.[key] !== undefined)
  const violations: string[] = []
  for (const key of Object.keys(value)) {
    const child = declaring(key)?.properties?.[key]
    if (child === undefined) {
      violations.push(`${path}.${key}`)
      continue
    }
    violations.push(...undeclaredKeys(child, value[key], `${path}.${key}`))
  }
  return violations
}

/** Top-level parameter names a tool schema declares, including `oneOf` branches. */
function declaredPropertiesOf(node: JsonSchemaNode): Set<string> {
  const names = new Set(Object.keys(node.properties ?? {}))
  for (const branch of node.oneOf ?? []) {
    for (const key of Object.keys(branch.properties ?? {})) names.add(key)
  }
  return names
}

const PARAM_HEADINGS = new Set(['参数', '参数与输出', 'Parameters', 'Parameters and output'])

/**
 * Parse parameter tables only under parameter subheadings. Slicing to the next
 * tool heading instead sweeps `## 错误码` rows into the preceding tool's
 * contract, so every heading ends the current table.
 */
function documentedParams(doc: string): Map<string, Set<string>> {
  const contracts = new Map<string, Set<string>>()
  let currentTool: string | undefined
  let inParamTable = false
  for (const line of doc.split('\n')) {
    const heading = /^(#{2,4})\s+(.+?)\s*$/.exec(line)
    if (heading) {
      const level = heading[1]!.length
      const title = heading[2]!
      inParamTable = false
      if (level <= 3) {
        const tool = /^((?:zotero|scholarly)_[a-z_]+)$/.exec(title)
        if (tool) currentTool = tool[1]!
        else if (level === 2) currentTool = undefined
      }
      if (level >= 3 && PARAM_HEADINGS.has(title) && currentTool !== undefined) {
        inParamTable = true
        if (!contracts.has(currentTool)) contracts.set(currentTool, new Set())
      }
      continue
    }
    if (!inParamTable || currentTool === undefined) continue
    const row = /^\|\s*`([A-Za-z0-9_]+)`\s*\|/.exec(line)
    if (row) contracts.get(currentTool)!.add(row[1]!)
  }
  return contracts
}

describe('research SOP contracts', () => {
  it('defines distinct routes with complete phased instructions and metadata', () => {
    expect(SOPS).toHaveLength(CORE_SOPS.length + SCHOLARLY_SOPS.length)
    expect(new Set(SOPS.map(({ name }) => name)).size).toBe(SOPS.length)
    const keywords = SOPS.flatMap(({ triggerKeywords }) => triggerKeywords)
    expect(new Set(keywords).size).toBe(keywords.length)
    for (const sop of SOPS) {
      expect(isSkillName(sop.name), `${sop.name}: upstream skill-name grammar`).toBe(true)
      expect(sop.name.startsWith('zotero-'), `${sop.name}: plugin prefix policy`).toBe(true)
      expect(sop.description.length).toBeGreaterThan(30)
      expect(sop.whenToUse.length).toBeGreaterThan(30)
      expect(sop.phases).toHaveLength(4)
      expect(sop.triggerKeywords.length).toBeGreaterThan(2)
      expect(sop.failureModes.length).toBeGreaterThan(1)
      const registration = skillRegistration(sop)
      for (const rule of SOP_CONTRACT_RULES) expect(registration.content).toContain(rule)
      expect(registration.content).toContain(EXTERNAL_AUTHORIZATION_RULE)
    }
  })

  it('keeps the combined roster unique so first-wins cannot silently drop one', () => {
    const core = new Set(CORE_SOPS.map(({ name }) => name))
    const scholarly = new Set(SCHOLARLY_SOPS.map(({ name }) => name))
    expect(core.size).toBe(CORE_SOPS.length)
    expect(scholarly.size).toBe(SCHOLARLY_SOPS.length)
    expect([...core].filter((name) => scholarly.has(name))).toEqual([])
    expect(SOPS).toHaveLength(core.size + scholarly.size)
  })

  it('keeps catalog descriptions and trigger keywords English-only', () => {
    for (const sop of SOPS) {
      expect(CJK.test(sop.description), `${sop.name}: description is English-only`).toBe(false)
      for (const keyword of sop.triggerKeywords)
        expect(CJK.test(keyword), `${sop.name}/${keyword}: English-only keyword`).toBe(false)
    }
  })

  it('keeps conditional external recipes behind their guard when Scholarly is absent', async () => {
    lane = await setupHostLane({ writeEnabled: true })
    const ctx = lane.ctx
    for (const sop of CORE_SOPS) {
      expect(skillRegistration(sop).content).toContain(EXTERNAL_AUTHORIZATION_RULE)
      for (const recipe of recipesOf(sop)) {
        if (!recipe.tool.startsWith('scholarly_')) continue
        expect(
          recipe.requires,
          `${sop.name}/${recipe.tool}: conditional recipe needs requires`,
        ).toBeDefined()
        expect(
          ctx.tools.get(recipe.tool),
          `${sop.name}/${recipe.tool}: absent without the component`,
        ).toBeUndefined()
      }
    }
  })

  it('validates every rendered recipe including nested values against actual tool schemas', async () => {
    lane = await setupHostLane(
      { writeEnabled: true },
      {
        compose: async (ctx) => {
          await ctx.plugin(ScholarlyService, {})
        },
      },
    )
    const ctx = lane.ctx
    const registered = new Set(ctx.tools.definitions().map(({ name }) => name))
    const violations: string[] = []
    for (const sop of SOPS) {
      const text = modelFacingText(sop)
      const references = new Set(text.match(/\b(?:zotero|scholarly)_[a-z_]+\b/g) ?? [])
      for (const name of references) {
        if (!registered.has(name)) violations.push(`${sop.name}: unknown tool ${name}`)
        if (!recipesOf(sop).some(({ tool }) => tool === name))
          violations.push(`${sop.name}: undocumented recipe ${name}`)
      }
      for (const recipe of recipesOf(sop)) {
        const tool = ctx.tools.get(recipe.tool)
        if (!tool) throw new Error(`Missing tool ${recipe.tool}`)
        const schema = tool.parameters as unknown as ObjectJsonSchema
        violations.push(
          ...undeclaredKeys(schema, recipe.args, '').map(
            (key) => `${sop.name}/${recipe.tool}: undeclared ${key}`,
          ),
        )
        violations.push(
          ...validateJsonSchemaValue(schema, recipe.args, '').map(
            (error) => `${sop.name}/${recipe.tool}: ${error}`,
          ),
        )
      }
    }
    expect(violations).toEqual([])
  })

  it('keeps recipe tools and parameters in both tool-reference documents in both directions', async () => {
    lane = await setupHostLane(
      { writeEnabled: true },
      {
        compose: async (ctx) => {
          await ctx.plugin(ScholarlyService, {})
        },
      },
    )
    const definitions = new Map(
      lane.ctx.tools.definitions().map((definition) => [definition.name, definition]),
    )
    for (const file of ['tools.md', 'tools.en.md']) {
      const doc = readFileSync(new URL(`../../docs/${file}`, import.meta.url), 'utf8')
      const contracts = documentedParams(doc)
      const headingCount = [...doc.matchAll(/^#{2,3} ((?:zotero|scholarly)_[a-z_]+)\s*$/gm)].length
      expect(contracts.size, `${file}: every tool heading owns a parameter table`).toBe(
        headingCount,
      )
      const violations: string[] = []
      for (const sop of SOPS)
        for (const recipe of recipesOf(sop)) {
          const documented = contracts.get(recipe.tool)
          if (!documented) violations.push(`${recipe.tool} missing`)
          for (const key of Object.keys(recipe.args))
            if (!documented?.has(key)) violations.push(`${recipe.tool}.${key} missing`)
        }
      for (const [tool, params] of contracts) {
        const definition = definitions.get(tool)
        if (!definition) {
          violations.push(`${tool} has no registered definition`)
          continue
        }
        const declared = declaredPropertiesOf(definition.parameters as unknown as ObjectJsonSchema)
        for (const param of params)
          if (!declared.has(param) && !isCompositionDependent(tool, param))
            violations.push(`${tool}.${param} not in schema`)
      }
      expect(violations, file).toEqual([])
    }
  })
})
