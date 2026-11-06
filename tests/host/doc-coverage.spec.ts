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
import { SCHOLARLY_CREDENTIAL_REFERENCE_NAMES } from '../../src/credential-names.js'
import { LibraryConfigSchema } from '../../src/library/config.js'
import { ScholarlyConfig } from '../../src/scholarly/config.js'

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
const totalFields = coreFields.length + libraryFields.length + scholarlyFields.length

describe('configuration docs agree with the schemas', () => {
  it('lists every field, the scholarly count, and the total in both languages', () => {
    const cases = [
      [
        'docs/configuration.md',
        `三组合计 ${totalFields} 个字段`,
        `${scholarlyFields.length} 个字段`,
      ],
      [
        'docs/configuration.en.md',
        `The three groups total ${totalFields} fields`,
        `${scholarlyFields.length} fields`,
      ],
    ] as const
    for (const [path, totalText, scholarlyText] of cases) {
      const text = docOf(path)
      for (const field of [...coreFields, ...libraryFields, ...scholarlyFields]) {
        expect(text, `${path} is missing the ${field} field`).toContain(field)
      }
      expect(text, `${path} is missing the field total`).toContain(totalText)
      expect(text, `${path} is missing the scholarly field count`).toContain(scholarlyText)
    }
  })

  it('names the suggested credential references from the shared module', () => {
    for (const path of ['docs/configuration.md', 'docs/configuration.en.md']) {
      const text = docOf(path)
      for (const name of Object.values(SCHOLARLY_CREDENTIAL_REFERENCE_NAMES)) {
        expect(text, `${path} is missing ${name}`).toContain(name)
      }
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
