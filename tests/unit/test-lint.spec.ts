/**
 * The test-lint guards' own rules, driven through the same functions the CLI
 * runs (`scripts/test-lint.mjs`). A guard whose regex stopped matching the
 * form its docstring names would fail the suite green, so each form the
 * docstring names has a case here — including the chained `.only` spellings
 * and the unconditional-disable forms of the conditional gates.
 * @module tests/unit/test-lint
 */

import { describe, expect, it } from 'vitest'
import {
  BINARY_EXTENSIONS,
  TEXT_EXTENSIONS,
  TEXT_ROOTS,
  focusViolationsOf,
  stripCommentsAndStrings,
  unscannedExtensionsOf,
} from '../../scripts/test-lint.mjs'

describe('focus guard', () => {
  it('flags the plain focused and disabled call forms', () => {
    for (const construct of ['it.only', 'test.only', 'describe.only', 'it.skip', 'it.todo']) {
      expect(focusViolationsOf(`${construct}('x', () => {})`)).toEqual([{ line: 1, construct }])
    }
  })

  it('flags the chained forms a line-based regex misses', () => {
    const source = [
      `it.only.each([1])('x', () => {})`,
      `it.concurrent.only('x', () => {})`,
      `describe.only.each([1])('x', () => {})`,
      `test.todo.each([1])('x', () => {})`,
      `it.sequential.skip('x', () => {})`,
    ].join('\n')
    const violations = focusViolationsOf(source)
    expect(violations.map((entry) => entry.construct)).toEqual([
      'it.only',
      'it.concurrent.only',
      'describe.only',
      'test.todo',
      'it.sequential.skip',
    ])
    expect(violations.map((entry) => entry.line)).toEqual([1, 2, 3, 4, 5])
  })

  it('flags a chain continued on the next line', async () => {
    // A line-based scan cannot see across the newline; the whole-content scan
    // is what makes this form catchable.
    const source = `const focus = process.env.F\nit\n  .only('x', () => {})`
    const violations = focusViolationsOf(source)
    expect(violations).toEqual([{ line: 2, construct: 'it.only' }])
  })

  it('flags the unconditional-disable spellings of the conditional gates', () => {
    const source = `it.skipIf(true)('x', () => {})\nrunIfFalse()\ndescribe.runIf(false)(() => {})`
    const violations = focusViolationsOf(source)
    expect(violations.map((entry) => entry.construct)).toEqual(['skipIf(true)', 'runIf(false)'])
  })

  it('leaves the sanctioned gates alone', () => {
    // `runIf` with a computed condition is the documented way to gate a
    // suite, and `each` without a focus modifier is an ordinary data table.
    const source = [
      `describe.runIf(process.env.ZOTERO_INTEGRATION === '1')('live', () => {})`,
      `it.each([1, 2])('x', (n) => {})`,
      `it.skipIf(process.env.CI)('x', () => {})`,
    ].join('\n')
    expect(focusViolationsOf(source)).toEqual([])
  })

  it('ignores matches inside comments and string literals', () => {
    const source = [
      `// it.only('commented out', () => {})`,
      `const note = 'never write it.skip here'`,
      `const doc = \`see it.todo below\``,
      `it('real test', () => {})`,
    ].join('\n')
    expect(focusViolationsOf(source)).toEqual([])
  })
})

describe('comment and string stripping', () => {
  it('preserves offsets so reported lines stay real', () => {
    const source = `const a = 1\n// it.only('x')\nconst b = 2\nit.skip('y')`
    const violations = focusViolationsOf(source)
    expect(violations).toEqual([{ line: 4, construct: 'it.skip' }])
  })

  it('keeps string content out but keeps code after a closed string', () => {
    const stripped = stripCommentsAndStrings(`const s = 'it.only(' + real()`)
    expect(stripped).toContain('real()')
    expect(stripped).not.toContain('only')
  })

  it('blanks block comments across lines without moving later lines', () => {
    const stripped = stripCommentsAndStrings('a\n/* it.only\nstill comment */\nb')
    expect(stripped.split('\n')).toHaveLength(4)
    expect(stripped).not.toContain('only')
  })
})

describe('extension coverage guard', () => {
  it('treats the shipped declaration flavor as text', () => {
    // The four `scripts/*.d.mts` contract files are read by the build gates;
    // an extension that is neither text nor binary is scanned by nothing.
    expect(TEXT_EXTENSIONS).toContain('.mts')
    expect(unscannedExtensionsOf(['scripts/verify-pack.d.mts'])).toEqual([])
  })

  it('names an extension nobody declared instead of silently skipping it', () => {
    expect(unscannedExtensionsOf(['docs/images/icon.png'])).toEqual([])
    expect(unscannedExtensionsOf(['docs/notes.wpd'])).toEqual(['.wpd'])
  })

  it('scans the locale catalogs as text roots', () => {
    expect(TEXT_ROOTS).toContain('locale')
    expect(BINARY_EXTENSIONS).toEqual(['.png'])
  })
})
