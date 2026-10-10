/**
 * Pin-move prose rewriting and the harness compatibility policy. The
 * historical version-mapping section must never be retargeted. Dev and overrides
 * take the exact pin; peers and engines become >=pin.
 * @module tests/unit/harness-state
 */

import { describe, expect, it } from 'vitest'
import {
  applyPinToManifest,
  checkProseText,
  checkVersionMap,
  collectLockProblems,
  collectPinFaceProblems,
  packageNameFromLockPath,
  retargetProse,
  versionMapBounds,
} from '../../scripts/harness-state.mjs'

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
    expect(versionMapBounds(['# Title', 'dsh 0.1.7-rc.1'])).toEqual({
      start: -1,
      end: -1,
    })
  })
})

describe('retargetProse', () => {
  it('moves the current-pin prose and leaves historical rows untouched', () => {
    const moved = retargetProse(DOC, '0.1.6-alpha.2', '0.1.7-rc.1')
    expect(moved).toContain('DSH 0.1.7-rc.1')
    expect(moved).toContain('| 0.8.4          | 0.1.5-rc.2          |')
    expect(moved).toContain('| 0.9.0          | 0.1.5-rc.1 or 0.1.6-alpha.2 |')
    // The last row is historical too until a release bump rewrites it on purpose.
    expect(moved).toContain('| 0.10.0         | 0.1.6-alpha.2       |')
    expect(moved).not.toContain('DSH 0.1.6-alpha.2')
  })

  it('migrates a legacy >= badge to the exact badge form', () => {
    const badge = 'https://img.shields.io/badge/dsh-%3E%3D0.1.6--alpha.2-blue'
    const moved = retargetProse(badge, '0.1.6-alpha.2', '0.1.7-rc.1')
    expect(moved).toContain('badge/dsh-0.1.7--rc.1-blue')
    expect(moved).not.toContain('%3E%3D')
  })

  it('rewrites an exact badge without inventing a range', () => {
    const badge = 'https://img.shields.io/badge/dsh-0.1.6--alpha.2-blue'
    const moved = retargetProse(badge, '0.1.6-alpha.2', '0.1.7-rc.1')
    expect(moved).toContain('badge/dsh-0.1.7--rc.1-blue')
  })

  it('rewrites a document that carries no version map', () => {
    const moved = retargetProse('use dsh 0.1.6-alpha.2 here', '0.1.6-alpha.2', '0.1.7-rc.1')
    expect(moved).toBe('use dsh 0.1.7-rc.1 here')
  })

  it('does not rewrite a longer number the old pin is a substring of', () => {
    // `0.1.6-alpha.2` is the tail of `10.1.6-alpha.2`; a bare replaceAll would
    // rewrite that unrelated build number's digits.
    const moved = retargetProse('built with qt 10.1.6-alpha.2', '0.1.6-alpha.2', '0.1.7-rc.1')
    expect(moved).toBe('built with qt 10.1.6-alpha.2')
  })

  it('leaves a longer prerelease that merely starts with the old pin', () => {
    const moved = retargetProse('host dsh 0.1.6-alpha.2-beta', '0.1.6-alpha.2', '0.1.7-rc.1')
    expect(moved).toBe('host dsh 0.1.6-alpha.2-beta')
  })

  it('still rewrites a v-prefixed prose mention', () => {
    const moved = retargetProse('requires dsh v0.1.6-alpha.2 today', '0.1.6-alpha.2', '0.1.7-rc.1')
    expect(moved).toBe('requires dsh v0.1.7-rc.1 today')
  })
})

describe('checkProseText', () => {
  it('matches prose version containing unicode ≥ symbol', () => {
    const text = '宿主 dsh ≥ 0.2.0-rc.2'
    const problems = checkProseText(text, '0.2.0-rc.2')
    expect(problems).toEqual([])
  })

  it('matches prose version containing multiple spaces before comparison operator', () => {
    const text = '宿主 dsh  >= 0.2.0-rc.2'
    const problems = checkProseText(text, '0.2.0-rc.2')
    expect(problems).toEqual([])
  })

  it('reports mismatch when unicode ≥ prose carries older pin', () => {
    const text = '宿主 dsh ≥ 0.1.6-alpha.2'
    const problems = checkProseText(text, '0.2.0-rc.2')
    expect(problems).toHaveLength(1)
    expect(problems[0]).toMatch(/still states harness version "0.1.6-alpha.2"/)
  })
})

describe('checkVersionMap', () => {
  it('accepts a last row that names the package version and the exact pin', () => {
    const source = DOC.replace(
      '| 0.10.0         | 0.1.6-alpha.2       |',
      '| 0.10.0         | 0.1.7-rc.1          |',
    )
    expect(checkVersionMap('doc.md', source, '0.10.0', '0.1.7-rc.1')).toEqual([])
  })

  it('rejects a last row that trails the package version or is not the exact pin', () => {
    const staleVersion = checkVersionMap('doc.md', DOC, '0.11.0', '0.1.6-alpha.2')
    expect(staleVersion.join('\n')).toMatch(/expected package version/)
    const stalePin = checkVersionMap('doc.md', DOC, '0.10.0', '0.1.7-rc.1')
    expect(stalePin.join('\n')).toMatch(/is not the exact pin/)
  })

  it('rejects a last row that only contains the pin inside a dual arm', () => {
    const source = DOC.replace(
      '| 0.10.0         | 0.1.6-alpha.2       |',
      '| 0.10.0         | 0.1.6-alpha.2 or 0.1.7-rc.1 |',
    )
    const errors = checkVersionMap('doc.md', source, '0.10.0', '0.1.7-rc.1')
    expect(errors.join('\n')).toMatch(/is not the exact pin/)
  })
})

describe('applyPinToManifest', () => {
  const manifest = () => ({
    engines: { node: '>=22', dsh: '^0.1.7-alpha.2' },
    dsh: { manifestVersion: 1, bundle: { patch: './cordis.patch.yml' } },
    dependencies: { '@deepseek-ai/dsh-llm': '^0.1.7-alpha.2', zod: '^4.4.3' },
    devDependencies: { '@deepseek-ai/dsh-tools': '0.1.7-alpha.2' },
    peerDependencies: { '@deepseek-ai/dsh-tools': '^0.1.7-alpha.2' },
    overrides: { '@deepseek-ai/dsh-tools': '0.1.7-alpha.2' },
  })

  it('writes the exact pin into dev/overrides and >=pin into peer/engines', () => {
    const next = applyPinToManifest(manifest(), '0.1.7-rc.1')
    expect(next.engines.dsh).toBe('>=0.1.7-rc.1')
    expect(next.dependencies['@deepseek-ai/dsh-llm']).toBe('0.1.7-rc.1')
    expect(next.devDependencies['@deepseek-ai/dsh-tools']).toBe('0.1.7-rc.1')
    expect(next.peerDependencies['@deepseek-ai/dsh-tools']).toBe('>=0.1.7-rc.1')
    expect(next.overrides['@deepseek-ai/dsh-tools']).toBe('0.1.7-rc.1')
    expect(next.dependencies.zod).toBe('^4.4.3')
    expect(next.engines.node).toBe('>=22')
    expect(JSON.stringify(next)).not.toContain('||')
    expect(JSON.stringify(next)).not.toContain('^0.1.7')
    expect(collectPinFaceProblems(next, '0.1.7-rc.1')).toEqual([])
  })

  it('never writes a dsh.harnessRange face', () => {
    // The field was self-invented: harness `evaluatePluginCompatibility`
    // reads peerDependencies alone. The manifest keeps its dsh block intact.
    const next = applyPinToManifest(manifest(), '0.1.7-rc.1')
    expect(next.dsh).toEqual({ manifestVersion: 1, bundle: { patch: './cordis.patch.yml' } })
    expect(JSON.stringify(next)).not.toContain('harnessRange')
  })
})

describe('collectPinFaceProblems', () => {
  const exact = () => ({
    engines: { dsh: '>=0.1.7-rc.1' },
    peerDependencies: { '@deepseek-ai/dsh-tools': '>=0.1.7-rc.1' },
  })

  it('accepts a manifest with no dsh block when the faces agree', () => {
    expect(collectPinFaceProblems(exact(), '0.1.7-rc.1')).toEqual([])
  })

  it('rejects caret peers', () => {
    const caret = {
      ...exact(),
      peerDependencies: { '@deepseek-ai/dsh-tools': '^0.1.7-rc.1' },
    }
    expect(collectPinFaceProblems(caret, '0.1.7-rc.1').join('\n')).toMatch(
      /expected ">=0\.1\.7-rc\.1"/,
    )
  })

  it('rejects a wrong exact version and a missing engines face', () => {
    const wrong = {
      engines: { dsh: '>=0.1.7-rc.2' },
    }
    const problems = collectPinFaceProblems(wrong, '0.1.7-rc.1')
    expect(problems.join('\n')).toMatch(/engines\.dsh is ">=0\.1\.7-rc\.2"/)
    // Zero dsh peers would load on any runtime (evaluatePluginCompatibility
    // reads only peerDependencies), that is a policy hole, not a silent pass.
    expect(problems.join('\n')).toMatch(/declares no @deepseek-ai\/dsh-\*/)
    expect(problems.join('\n')).not.toMatch(/harnessRange/)
  })

  it('rejects a manifest that dropped every dsh peer', () => {
    const problems = collectPinFaceProblems(
      {
        engines: { dsh: '>=0.1.7-rc.1' },
        peerDependencies: { zod: '^4.4.3' },
      },
      '0.1.7-rc.1',
    )
    expect(problems.join('\n')).toMatch(/declares no @deepseek-ai\/dsh-\*/)
    expect(problems.join('\n')).toMatch(/at least one dsh peer/)
  })

  it('rejects a reintroduced dsh.harnessRange face', () => {
    // The runtime never read it; the field was removed on purpose.
    const leftover = {
      ...exact(),
      dsh: { harnessRange: '>=0.1.7-rc.1' },
    }
    expect(collectPinFaceProblems(leftover, '0.1.7-rc.1').join('\n')).toMatch(/dsh\.harnessRange/)
  })

  it('does not confuse a longer prerelease with the pin', () => {
    // `dsh 0.1.7-rc.1-beta` must not be accepted as the pin `0.1.7-rc.1`.
    const moved = retargetProse('host dsh 0.1.7-rc.1-beta', '0.1.7-rc.1', '0.1.7-rc.1')
    expect(moved).toContain('0.1.7-rc.1-beta')
  })

  it('rejects a client inject missing from peerDependencies', () => {
    const missing = {
      ...exact(),
      dsh: { client: { inject: ['@deepseek-ai/dsh-client-ui-tool'] } },
    }
    const problems = collectPinFaceProblems(missing, '0.1.7-rc.1')
    expect(problems.join('\n')).toMatch(
      /peerDependencies is missing "@deepseek-ai\/dsh-client-ui-tool"/,
    )
  })
})

describe('collectLockProblems', () => {
  const pin = '0.1.7-rc.2'
  const validLock = {
    packages: {
      'node_modules/@deepseek-ai/dsh-tools': { version: pin },
      'node_modules/@deepseek-ai/dsh-llm': { version: pin },
      'node_modules/zod': { version: '3.22.4' },
    },
  }
  const validManifest = {
    overrides: {
      '@deepseek-ai/dsh-tools': pin,
      '@deepseek-ai/dsh-llm': pin,
    },
  }

  it('accepts clean lock and complete overrides', () => {
    expect(collectLockProblems(validLock, validManifest, pin)).toEqual([])
  })

  it('detects packages resolving off the pin', () => {
    const staleLock = {
      packages: {
        'node_modules/@deepseek-ai/dsh-tools': { version: '0.1.7-rc.1' },
      },
    }
    const problems = collectLockProblems(staleLock, validManifest, pin)
    expect(problems.join('\n')).toMatch(
      /resolves 1 harness package\(s\) off the pin "0\.1\.7-rc\.2"/,
    )
  })

  it('detects when overrides is missing a dsh package from lockfile', () => {
    const incompleteManifest = {
      overrides: {
        '@deepseek-ai/dsh-tools': pin,
      },
    }
    const problems = collectLockProblems(validLock, incompleteManifest, pin)
    expect(problems.join('\n')).toMatch(
      /package\.json overrides is missing 1 @deepseek-ai\/dsh-\* package\(s\)/,
    )
    expect(problems.join('\n')).toContain('@deepseek-ai/dsh-llm')
  })

  it('detects a manifest dsh package that the lockfile never resolves', () => {
    const partialLock = {
      packages: {
        'node_modules/@deepseek-ai/dsh-tools': { version: pin },
      },
    }
    const problems = collectLockProblems(partialLock, validManifest, pin)
    expect(problems.join('\n')).toMatch(
      /package-lock\.json is missing 1 @deepseek-ai\/dsh-\* package\(s\) the manifest declares/,
    )
    expect(problems.join('\n')).toContain('@deepseek-ai/dsh-llm')
  })

  it('detects a root lock entry whose dev/peer dsh keys drift from the manifest', () => {
    const manifestWithDev = {
      overrides: {
        '@deepseek-ai/dsh-tools': pin,
        '@deepseek-ai/dsh-llm': pin,
      },
      devDependencies: {
        '@deepseek-ai/dsh-tools': pin,
        '@deepseek-ai/dsh-llm': pin,
      },
    }
    const driftedLock = {
      packages: {
        '': {
          devDependencies: {
            '@deepseek-ai/dsh-tools': pin,
          },
        },
        'node_modules/@deepseek-ai/dsh-tools': { version: pin },
        'node_modules/@deepseek-ai/dsh-llm': { version: pin },
      },
    }
    const problems = collectLockProblems(driftedLock, manifestWithDev, pin)
    expect(problems.join('\n')).toMatch(
      /package-lock\.json root entry devDependencies drifts from package\.json/,
    )
    expect(problems.join('\n')).toContain('@deepseek-ai/dsh-llm')
  })

  it('ignores root and non-node_modules package paths', () => {
    const lockWithWorkspace = {
      packages: {
        '': {},
        'packages/@deepseek-ai/dsh-tools': { version: '0.0.1' },
        'packages/my-custom-plugin': { version: '1.0.0' },
        'node_modules/@deepseek-ai/dsh-tools': { version: pin },
        'node_modules/@deepseek-ai/dsh-llm': { version: pin },
      },
    }
    expect(collectLockProblems(lockWithWorkspace, validManifest, pin)).toEqual([])
  })
})

describe('packageNameFromLockPath', () => {
  it('extracts the package name from a standard node_modules entry', () => {
    expect(packageNameFromLockPath('node_modules/@deepseek-ai/dsh-tools')).toBe(
      '@deepseek-ai/dsh-tools',
    )
  })

  it('extracts the package name from nested node_modules', () => {
    expect(packageNameFromLockPath('node_modules/foo/node_modules/@deepseek-ai/dsh-llm')).toBe(
      '@deepseek-ai/dsh-llm',
    )
  })

  it('returns undefined for the root package entry', () => {
    expect(packageNameFromLockPath('')).toBeUndefined()
  })

  it('returns undefined for paths outside node_modules', () => {
    expect(packageNameFromLockPath('packages/my-custom-plugin')).toBeUndefined()
    expect(packageNameFromLockPath('packages/@deepseek-ai/dsh-tools')).toBeUndefined()
  })
})
