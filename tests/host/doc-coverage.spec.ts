/**
 * Configuration and tool-contract docs checked against the schemas that own
 * them. Documentation drift is a contract bug here: a settings table that
 * omits a schema field, a tool page that forgets a declared parameter, or a
 * troubleshooting pair that loses a section sends a reader to a surface that
 * no longer matches the build.
 * @module tests/host/doc-coverage
 */

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { Config as CoreConfig } from '../../src/config.js'
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
