/**
 * Pin-move prose rewriting: the historical version-mapping section must never
 * be retargeted. A bare replaceAll of the old pin is what used to rewrite
 * release history inside the table on every `harness:pin`.
 * @module tests/unit/harness-state
 */

import { describe, expect, it } from 'vitest'
import { checkVersionMap, retargetProse, versionMapBounds } from '../../scripts/harness-state.mjs'

const DOC = `# Getting Started

- DSH 0.1.6-alpha.2 (peer dependencies)

Version mapping:

| Plugin version | Minimum dsh version |
| -------------- | ------------------- |
| 0.8.4          | 0.1.5-rc.2          |
| 0.9.0          | 0.1.5-rc.1 or 0.1.6-alpha.2 |
| 0.10.0         | 0.1.6-alpha.2       |

## Install
`

describe('versionMapBounds', () => {
  it('finds the mapping section through the next heading', () => {
    const lines = DOC.split('\n')
    const { start, end } = versionMapBounds(lines)
    expect(lines[start]).toMatch(/Version mapping/)
    expect(lines[end]).toBe('## Install')
  })

  it('reports absence without inventing a section', () => {
    expect(versionMapBounds(['# Title', 'dsh 0.1.7-alpha.2'])).toEqual({
      start: -1,
      end: -1,
    })
  })
})

describe('retargetProse', () => {
  it('moves the current-pin prose and leaves historical rows untouched', () => {
    const moved = retargetProse(DOC, '0.1.6-alpha.2', '0.1.7-alpha.2')
    expect(moved).toContain('DSH 0.1.7-alpha.2')
    expect(moved).toContain('| 0.8.4          | 0.1.5-rc.2          |')
    expect(moved).toContain('| 0.9.0          | 0.1.5-rc.1 or 0.1.6-alpha.2 |')
    // The last row is historical too until a release bump rewrites it on purpose.
    expect(moved).toContain('| 0.10.0         | 0.1.6-alpha.2       |')
    expect(moved).not.toContain('DSH 0.1.6-alpha.2')
  })

  it('rewrites badge encodings outside the mapping table', () => {
    const badge = 'https://img.shields.io/badge/dsh-%3E%3D0.1.6--alpha.2-blue'
    const moved = retargetProse(badge, '0.1.6-alpha.2', '0.1.7-alpha.2')
    expect(moved).toContain('%3E%3D0.1.7--alpha.2-blue')
  })

  it('rewrites a document that carries no version map', () => {
    const moved = retargetProse('use dsh 0.1.6-alpha.2 here', '0.1.6-alpha.2', '0.1.7-alpha.2')
    expect(moved).toBe('use dsh 0.1.7-alpha.2 here')
  })
})

describe('checkVersionMap', () => {
  it('accepts a last row that names the package version and the pin', () => {
    const source = DOC.replace(
      '| 0.10.0         | 0.1.6-alpha.2       |',
      '| 0.10.0         | 0.1.7-alpha.2       |',
    )
    expect(checkVersionMap('doc.md', source, '0.10.0', '0.1.7-alpha.2')).toEqual([])
  })

  it('rejects a last row that trails the package version or the pin', () => {
    const staleVersion = checkVersionMap('doc.md', DOC, '0.11.0', '0.1.6-alpha.2')
    expect(staleVersion.join('\n')).toMatch(/expected package version/)
    const stalePin = checkVersionMap('doc.md', DOC, '0.10.0', '0.1.7-alpha.2')
    expect(stalePin.join('\n')).toMatch(/does not include the pin/)
  })
})
