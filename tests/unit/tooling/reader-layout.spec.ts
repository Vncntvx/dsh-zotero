/**
 * The Reader's drawer breakpoint is stated twice — `@container reader
 * (max-width: 56rem)` decides the layout and `DRAWER_MAX_REM` decides which
 * panels may be open — and a value that drifts between them would leave the
 * runtime opening a second drawer the stylesheet is already laying out side by
 * side. This pins the pair.
 * @module tests/unit/tooling/reader-layout
 */

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { DRAWER_MAX_REM, TOOLBAR_COMPACT_MAX_REM } from '../../../src/client/reader/layout.ts'

const stylesheet = readFileSync(
  new URL('../../../src/client/reader/reader.module.css', import.meta.url),
  'utf8',
)

describe('the Reader drawer breakpoint', () => {
  it('states the same breakpoints as the stylesheet', () => {
    const values = new Set(
      [...stylesheet.matchAll(/@container reader \(max-width: (\d+(?:\.\d+)?)rem\)/g)].map(
        (match) => Number(match[1]),
      ),
    )
    expect([...values].sort()).toEqual([TOOLBAR_COMPACT_MAX_REM, DRAWER_MAX_REM].sort())
  })
})
