/**
 * Configuration and tool-contract docs checked against the schemas that own
 * them. Documentation drift is a contract bug here: a settings table that
 * omits a schema field, a tool page that forgets a declared parameter, or a
 * troubleshooting pair that loses a section sends a reader to a surface that
 * no longer matches the build.
 * @module tests/host/doc-coverage
 */

import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { Config as CoreConfig } from '../../src/config.js'
import { ZOTERO_ERROR_CODES } from '../../src/errors.js'
import {
  ENRICHMENT_CREDENTIAL_REFERENCE_NAMES,
  SCHOLARLY_CREDENTIAL_REFERENCE_NAMES,
} from '../../src/credential-names.js'
import { LibraryConfigSchema } from '../../src/library/config.js'
import { ScholarlyConfig } from '../../src/scholarly/config.js'
import { EnrichmentConfigSchema } from '../../src/enrichment/config.js'

const REPO_ROOT = new URL('../../', import.meta.url)

/** @param path - repo-relative docs path. @returns the document text. */
function docOf(path: string): string {
  return readFileSync(new URL(path, REPO_ROOT), 'utf8')
}

/** @param schema - one component's Schemastery config schema. @returns its defaulted field names. */
function fieldsOf(schema: unknown): string[] {
  const standard = (
    schema as {
      '~standard': {
        validate(value: unknown): { value?: unknown; issues?: unknown }
      }
    }
  )['~standard']
  const result = standard.validate({})
  if (result.issues !== undefined) {
    throw new Error('schema defaults failed: ' + JSON.stringify(result.issues))
  }
  return Object.keys(result.value as object)
}

/** The defaulted field values one component schema declares. */
function defaultsOf(schema: unknown): Record<string, unknown> {
  const dict = (schema as { dict?: Record<string, { meta?: { default?: unknown } }> }).dict ?? {}
  const defaults: Record<string, unknown> = {}
  for (const [field, entry] of Object.entries(dict)) {
    if (entry?.meta !== undefined && 'default' in entry.meta) defaults[field] = entry.meta.default
  }
  return defaults
}

/**
 * The schema one configuration section documents, keyed by the section's own
 * heading. The same field name can mean different things per component
 * (`foregroundWaitMs` is 4000 in the core and 30000 in the scholarly schema),
 * so a whole-document scan would compare the wrong default.
 */
function schemaOf(coreFieldsCount: number) {
  return (heading: string): Record<string, unknown> | undefined => {
    if (heading.includes('核心字段') || heading.includes('Core fields')) {
      void coreFieldsCount
      return defaultsOf(CoreConfig)
    }
    if (heading.includes('`dsh-zotero/scholarly`')) return defaultsOf(ScholarlyConfig)
    if (heading.includes('`dsh-zotero/library`')) return defaultsOf(LibraryConfigSchema)
    if (heading.includes('`dsh-zotero/enrichment`')) return defaultsOf(EnrichmentConfigSchema)
    return undefined
  }
}

const coreFields = fieldsOf(CoreConfig)
const libraryFields = fieldsOf(LibraryConfigSchema)
const scholarlyFields = fieldsOf(ScholarlyConfig)
const enrichmentFields = fieldsOf(EnrichmentConfigSchema)
const totalFields =
  coreFields.length + libraryFields.length + scholarlyFields.length + enrichmentFields.length

describe('configuration docs agree with the schemas', () => {
  it('lists every field, the scholarly/enrichment counts, and the total in both languages', () => {
    const cases = [
      [
        'docs/configuration.md',
        `四组合计 ${totalFields} 个字段`,
        `${scholarlyFields.length} 个字段`,
        `${enrichmentFields.length} 个字段`,
      ],
      [
        'docs/configuration.en.md',
        `The four groups total ${totalFields} fields`,
        `${scholarlyFields.length} fields`,
        `${enrichmentFields.length} fields`,
      ],
    ] as const
    for (const [path, totalText, scholarlyText, enrichmentText] of cases) {
      const text = docOf(path)
      for (const field of [
        ...coreFields,
        ...libraryFields,
        ...scholarlyFields,
        ...enrichmentFields,
      ]) {
        expect(text, `${path} is missing the ${field} field`).toContain(field)
      }
      expect(text, `${path} is missing the field total`).toContain(totalText)
      expect(text, `${path} is missing the scholarly field count`).toContain(scholarlyText)
      expect(text, `${path} is missing the enrichment field count`).toContain(enrichmentText)
    }
  })

  it("states each group's field count, not only their total", () => {
    // The total alone lets one group borrow another's fields: 36 + 12 + 9 + 7
    // is still 64. Each count is derived from its own schema.
    for (const [path, coreText, libraryText] of [
      [
        'docs/configuration.md',
        `\`src/config.ts\`，${coreFields.length} 个字段`,
        `\`src/library/config.ts\`，${libraryFields.length} 个字段`,
      ],
      [
        'docs/configuration.en.md',
        `\`src/config.ts\`, ${coreFields.length} fields`,
        `\`src/library/config.ts\`, ${libraryFields.length} fields`,
      ],
    ] as const) {
      const text = docOf(path)
      expect(text, `${path} is missing the core field count`).toContain(coreText)
      expect(text, `${path} is missing the library field count`).toContain(libraryText)
    }
  })

  it('prints the schema default for every numeric and boolean field', () => {
    // A table row that says 9 where the schema says 8 is a wrong instruction;
    // prose cells (`configured default`, `—`) are skipped, and quoted strings
    // are compared as JSON so an enum default is checked too.
    for (const path of ['docs/configuration.md', 'docs/configuration.en.md']) {
      const text = docOf(path)
      const schemaFor = schemaOf(coreFields.length)
      const violations: string[] = []
      let compared = 0
      for (const section of text.split(/^## /m)) {
        const heading = section.split('\n', 1)[0] ?? ''
        const defaults = schemaFor(heading)
        if (defaults === undefined) continue
        const rows = section.matchAll(/^\|\s*`([A-Za-z][\w]*)`\s*\|\s*([^|]*?)\s*\|/gm)
        for (const [, field, cell] of rows) {
          if (field === undefined || cell === undefined || !(field in defaults)) continue
          const expected = defaults[field]
          const literal = /^`([^`]*)`$/.exec(cell)
          if (literal === null) continue
          const raw = literal[1]!
          if (typeof expected === 'boolean') {
            if (raw !== 'true' && raw !== 'false') continue
            compared += 1
            if ((raw === 'true') !== expected) {
              violations.push(
                `${path} ${field}: table says ${raw}, schema default is ${String(expected)}`,
              )
            }
            continue
          }
          if (typeof expected === 'number') {
            if (!/^-?\d+(\.\d+)?$/.test(raw)) continue
            compared += 1
            if (Number(raw) !== expected) {
              violations.push(
                `${path} ${field}: table says ${raw}, schema default is ${String(expected)}`,
              )
            }
            continue
          }
          if (typeof expected === 'string' && raw.startsWith('"') && raw.endsWith('"')) {
            compared += 1
            if (JSON.parse(raw) !== expected) {
              violations.push(`${path} ${field}: table says ${raw}, schema default is ${expected}`)
            }
          }
        }
      }
      // The guard that the scan still compares something: a parser that
      // matched no row would pass every case above.
      expect(compared, `${path} matched no default rows`).toBeGreaterThan(30)
      expect(violations).toEqual([])
    }
  })

  it('names the suggested credential references from the shared module', () => {
    for (const path of ['docs/configuration.md', 'docs/configuration.en.md']) {
      const text = docOf(path)
      for (const name of [
        ...Object.values(SCHOLARLY_CREDENTIAL_REFERENCE_NAMES),
        ...Object.values(ENRICHMENT_CREDENTIAL_REFERENCE_NAMES),
      ]) {
        expect(text, `${path} is missing ${name}`).toContain(name)
      }
    }
  })
})

describe('the documentation set stays complete', () => {
  it('pairs every document with its English half and its section count', () => {
    // A missing translation or a section added to one side only is invisible
    // to every other check: they all read the files they are given.
    const names = readdirSync(new URL('docs/', REPO_ROOT)).filter(
      (name) => name.endsWith('.md') && !name.endsWith('.en.md'),
    )
    const count = (text: string): number => text.match(/^## /gm)?.length ?? 0
    const violations: string[] = []
    for (const name of names) {
      const english = `docs/${name.slice(0, -'.md'.length)}.en.md`
      let paired: string
      try {
        paired = docOf(english)
      } catch {
        violations.push(`${english} is missing`)
        continue
      }
      const zh = count(docOf(`docs/${name}`))
      const en = count(paired)
      if (zh !== en) violations.push(`${name}: ${zh} sections, ${english}: ${en}`)
    }
    expect(violations).toEqual([])
  })

  it('documents every stable error code in the tool reference', () => {
    const codes: readonly string[] = ZOTERO_ERROR_CODES
    for (const path of ['docs/tools.md', 'docs/tools.en.md']) {
      const text = docOf(path)
      const start = Math.max(text.indexOf('## 错误码'), text.indexOf('## Error codes'))
      expect(start, `${path} has no error-code table`).toBeGreaterThanOrEqual(0)
      const table = text.slice(start)
      const missing = codes.filter((code) => !table.includes(code))
      expect(missing, `${path} is missing error codes`).toEqual([])
    }
  })
})

describe('component and settings docs stay in lockstep', () => {
  it('describes four namespaces and seven tabs everywhere, never the stale three/six', () => {
    const zhConfig = docOf('docs/configuration.md')
    expect(zhConfig).toContain('7 标签页')
    expect(zhConfig).toContain('四个命名空间')
    expect(zhConfig).not.toContain('6 标签页')
    expect(zhConfig).not.toContain('三个命名空间')

    const enConfig = docOf('docs/configuration.en.md')
    expect(enConfig).toContain('7-tab')
    expect(enConfig).toContain('four namespaces')
    expect(enConfig).not.toContain('6-tab')
    expect(enConfig).not.toContain('three namespaces')

    expect(docOf('docs/index.md')).toContain('四个设置命名空间')
    expect(docOf('docs/index.en.md')).toContain('four settings namespaces')
    // The totals are computed from the live schemas, so a field count can
    // never silently make these sentences false.
    const total = totalFields
    expect(docOf('docs/development.md')).toContain(`四个设置命名空间、${total} 个字段`)
    expect(docOf('docs/development.en.md')).toContain(`Four settings namespaces, ${total} fields`)
    expect(docOf('docs/configuration.md')).toContain(`四组合计 ${total} 个字段`)
    expect(docOf('docs/configuration.en.md')).toContain(`The four groups total ${total} fields`)
    expect(docOf('docs/product-model.en.md')).toContain('four decoupled components')
    expect(docOf('docs/product-model.en.md')).not.toContain('three decoupled components')
  })

  it('names enrichment as an external-request boundary and keeps AGENTS current', () => {
    for (const [path, stale, current] of [
      ['docs/architecture.md', '外部请求只来自学术检索组件；', '文档解析'],
      [
        'docs/architecture.en.md',
        'external requests come only from the scholarly retrieval component;',
        'document parsing component',
      ],
    ] as const) {
      const text = docOf(path)
      expect(text, `${path} still carries the stale boundary`).not.toContain(stale)
      expect(text, `${path} should name the enrichment component`).toContain(current)
    }

    const agents = docOf('AGENTS.md')
    expect(agents).toContain('four Cordis bundle components')
    expect(agents).toContain('src/enrichment/')
    expect(agents).toContain('mineru.net')
    expect(agents).toContain('MinerU')

    for (const [path, marker] of [
      ['README.md', '文档解析'],
      ['README.en.md', 'document parsing component'],
      ['docs/features.md', '文档解析'],
      ['docs/features.en.md', 'Document Enrichment'],
    ] as const) {
      expect(docOf(path), `${path} should describe the enrichment component`).toContain(marker)
    }
  })

  it('keeps the client comments on the seven-tab surface', () => {
    for (const path of [
      'src/client/ZoteroSettingsSection.tsx',
      'src/client/index.ts',
      'src/client/ScholarlySettingsForm.tsx',
    ]) {
      const text = docOf(path)
      expect(text, `${path} still says 6-tab`).not.toContain('6-tab')
      expect(text, `${path} still says 6 标签`).not.toContain('6 标签')
    }
  })
})

describe('scholarly tool docs agree with the tool contract', () => {
  it('documents run_in_background on the three long tools and both credential codes', () => {
    const cases = [
      ['docs/tools.md', '## 学术文献检索组件工具'],
      ['docs/tools.en.md', '## Scholarly literature retrieval component tools'],
    ] as const
    for (const [path, marker] of cases) {
      const text = docOf(path)
      const start = text.indexOf(marker)
      expect(start, `${path} is missing the scholarly component section`).toBeGreaterThanOrEqual(0)
      const section = text.slice(start)
      expect(
        section.match(/run_in_background/g)?.length ?? 0,
        `${path} should document run_in_background on search, read, and verify`,
      ).toBeGreaterThanOrEqual(3)
      expect(text).toContain('ZOTERO_SCHOLARLY_CREDENTIALS_UNAVAILABLE')
      expect(text).toContain('ZOTERO_SCHOLARLY_CREDENTIAL_UNRESOLVED')
    }
  })

  it('keeps the troubleshooting pair in lockstep and lists both credential codes', () => {
    const zh = docOf('docs/troubleshooting.md')
    const en = docOf('docs/troubleshooting.en.md')
    const count = (text: string) => text.match(/^## /gm)?.length ?? 0
    expect(count(zh)).toBe(count(en))
    for (const code of [
      'ZOTERO_SCHOLARLY_CREDENTIALS_UNAVAILABLE',
      'ZOTERO_SCHOLARLY_CREDENTIAL_UNRESOLVED',
    ]) {
      expect(zh).toContain(code)
      expect(en).toContain(code)
    }
  })
})
