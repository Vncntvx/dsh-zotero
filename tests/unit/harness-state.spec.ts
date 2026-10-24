/**
 * The harness compatibility policy: dev and overrides take the exact pin,
 * peers and engines become >=pin, the lockfile resolves the pin, and vendored
 * framework floors match the sibling. Documents are out of scope: they record
 * what each released plugin version required, not the current pin.
 * @module tests/unit/harness-state
 */

import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { resolveHarnessRoot } from '../../scripts/shared/harness-packages.mjs'
import {
  applyPinToManifest,
  collectArtifactProblems,
  collectLockProblems,
  collectPinFaceProblems,
  collectVendorProblems,
  packageNameFromLockPath,
} from '../../scripts/harness-state.mjs'

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
    // The field was self-invented: harness compatibility evaluation never
    // read it. The manifest keeps its dsh block intact.
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
    // Zero dsh peers would skip npm peer checks and degrade package manager
    // dependency resolution; that is a policy hole, not a silent pass.
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
    // `>=0.1.7-rc.1-beta` must not be accepted as the pin `0.1.7-rc.1`.
    const longer = {
      engines: { dsh: '>=0.1.7-rc.1-beta' },
      peerDependencies: { '@deepseek-ai/dsh-tools': '>=0.1.7-rc.1' },
    }
    expect(collectPinFaceProblems(longer, '0.1.7-rc.1').join('\n')).toMatch(
      /engines\.dsh is ">=0\.1\.7-rc\.1-beta"/,
    )
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

describe('collectVendorProblems', () => {
  /**
   * A synthesized sibling checkout: the gate reads vendor/<dir>/package.json
   * and nothing else, so each case writes exactly the version it asserts on and
   * never depends on the local checkout's build state.
   */
  let tree: string

  beforeEach(() => {
    tree = mkdtempSync(join(tmpdir(), 'dsh-vendor-state-'))
  })

  afterEach(() => {
    rmSync(tree, { recursive: true, force: true })
  })

  /** Write one vendored package under the sibling's vendor/ tree. */
  function writeVendor(dir: string, name: string, version: string): void {
    const pkgDir = join(tree, 'vendor', dir)
    mkdirSync(pkgDir, { recursive: true })
    writeFileSync(join(pkgDir, 'package.json'), JSON.stringify({ name, version }))
  }

  it('reports a prerelease floor against the stable version the sibling publishes', () => {
    writeVendor('cordis', '@deepseek-ai/cordis', '4.0.5')
    const problems = collectVendorProblems(tree, {
      devDependencies: { '@deepseek-ai/cordis': '^4.0.5-alpha.2' },
    })
    expect(problems).toHaveLength(1)
    expect(problems[0]).toMatch(/devDependencies\["@deepseek-ai\/cordis"\] is "\^4\.0\.5-alpha\.2"/)
    expect(problems[0]).toMatch(/floor is 4\.0\.5-alpha\.2/)
    expect(problems[0]).toMatch(/publishes 4\.0\.5/)
  })

  it('accepts every range form whose floor is the published version', () => {
    // Caret, comparison, and exact all resolve to the same copy here; the gate
    // compares floors, not spellings, so all three pass.
    writeVendor('cordis', '@deepseek-ai/cordis', '4.0.5')
    expect(
      collectVendorProblems(tree, {
        dependencies: { '@deepseek-ai/cordis': '4.0.5' },
        devDependencies: { '@deepseek-ai/cordis': '^4.0.5' },
        peerDependencies: { '@deepseek-ai/cordis': '>=4.0.5' },
      }),
    ).toEqual([])
  })

  it('reports a floor ahead of the version the sibling publishes', () => {
    // The declaration names a release the sibling has not cut: resolving it
    // installs a second copy sooner than any prerelease floor would.
    writeVendor('cordis', '@deepseek-ai/cordis', '4.0.5')
    const problems = collectVendorProblems(tree, {
      devDependencies: { '@deepseek-ai/cordis': '^4.0.6' },
    })
    expect(problems).toHaveLength(1)
    expect(problems[0]).toMatch(/floor is 4\.0\.6/)
    expect(problems[0]).toMatch(/publishes 4\.0\.5/)
  })

  it('checks every declared section, not only dependencies', () => {
    // One package may be declared in several sections, each free to drift on
    // its own; a gate that read one of them would pass the other two.
    writeVendor('schemastery', '@deepseek-ai/schemastery', '3.18.5')
    const problems = collectVendorProblems(tree, {
      dependencies: { '@deepseek-ai/schemastery': '^3.18.4' },
      devDependencies: { '@deepseek-ai/schemastery': '^3.18.6' },
      peerDependencies: { '@deepseek-ai/schemastery': '>=3.18.5' },
    })
    expect(problems).toHaveLength(2)
    expect(problems.join('\n')).toMatch(
      /dependencies\["@deepseek-ai\/schemastery"\] is "\^3\.18\.4"/,
    )
    expect(problems.join('\n')).toMatch(
      /devDependencies\["@deepseek-ai\/schemastery"\] is "\^3\.18\.6"/,
    )
  })

  it('reports a protocol specifier that carries no floor to compare', () => {
    writeVendor('cosmokit', '@deepseek-ai/cosmokit', '1.8.6')
    const problems = collectVendorProblems(tree, {
      dependencies: { '@deepseek-ai/cosmokit': 'link:../deepseek-harness/vendor/cosmokit' },
    })
    expect(problems).toHaveLength(1)
    expect(problems[0]).toMatch(/is not a semver range/)
  })

  it('stays quiet when the sibling checkout is absent', () => {
    // No sibling installed is a working day-to-day state: the registry copy is
    // what the build resolves, so there is nothing to disagree with.
    expect(
      collectVendorProblems(join(tree, 'missing-harness'), {
        devDependencies: { '@deepseek-ai/cordis': '^4.0.5-alpha.2' },
      }),
    ).toEqual([])
  })

  it('ignores packages the sibling publishes outside the vendor tree', () => {
    // A @deepseek-ai/* dependency the harness pin already covers, or one the
    // sibling does not carry at all, is not this gate's business.
    const pkgDir = join(tree, 'packages/core/dsh-brand')
    mkdirSync(pkgDir, { recursive: true })
    writeFileSync(
      join(pkgDir, 'package.json'),
      JSON.stringify({ name: '@deepseek-ai/dsh-brand', version: '0.2.1-rc.2' }),
    )
    expect(
      collectVendorProblems(tree, {
        devDependencies: {
          '@deepseek-ai/dsh-brand': '0.2.1-rc.2',
          '@deepseek-ai/dsh-not-carried': '^0.2.1',
        },
      }),
    ).toEqual([])
  })

  it('refuses an override that pins a vendored package, whatever it pins', () => {
    // The floor agreement is only expressible through the three declaration
    // sections, so an override cannot carry it — and every other gate (pin
    // face, lock, override names) skips non-`dsh-*` names, so without this arm
    // the override would pass silently and the lockfile could resolve a second
    // copy of the framework the shell already loads.
    writeVendor('cordis', '@deepseek-ai/cordis', '4.0.5')
    const problems = collectVendorProblems(tree, {
      devDependencies: { '@deepseek-ai/cordis': '^4.0.5' },
      overrides: { '@deepseek-ai/cordis': '4.0.5' },
    })
    expect(problems).toHaveLength(1)
    expect(problems[0]).toMatch(/overrides\["@deepseek-ai\/cordis"\]/)
    expect(problems[0]).toMatch(/drop the override/)
  })

  it('accepts overrides that name only harness packages', () => {
    // The pin's own arm: `overrides` is where every `dsh-*` package is pinned
    // exact, so a manifest full of them must stay quiet.
    writeVendor('cordis', '@deepseek-ai/cordis', '4.0.5')
    expect(
      collectVendorProblems(tree, {
        devDependencies: { '@deepseek-ai/cordis': '^4.0.5' },
        overrides: { '@deepseek-ai/dsh-tools': '0.2.1-alpha.4' },
      }),
    ).toEqual([])
  })
})

describe('collectArtifactProblems', () => {
  /**
   * A synthesized sibling checkout. The real checkout freshness depends on when
   * this machine last built it, which is the variable under test, so each case
   * writes the mtimes it asserts on without depending on local checkout state.
   */
  let tree: string

  beforeEach(() => {
    tree = mkdtempSync(join(tmpdir(), 'dsh-harness-state-'))
  })

  afterEach(() => {
    rmSync(tree, { recursive: true, force: true })
  })

  /**
   * Write one client package: `packages/client/<dir>` with a `./client` export,
   * the declarations that export points at, a source file, and the runtime
   * bundle. `null` omits that file; each remaining value is its age in seconds
   * before now, so a larger number is older.
   */
  function writePackage(
    name: string,
    times: { source?: number | null; declaration?: number | null; runtime?: number | null },
  ): void {
    const dir = join(tree, 'packages/client', name)
    const manifest = {
      name: `@deepseek-ai/${name}`,
      exports: {
        './client': { types: './lib/types/client/index.d.ts', default: './lib/client.js' },
      },
    }
    const files: Record<string, string> = {
      'package.json': JSON.stringify(manifest),
      'src/panel.ts': 'export const panel = 1\n',
      'lib/types/client/index.d.ts': 'export declare const panel: number\n',
      'lib/client.js': 'window.__ModuleLoader__?.load({})\n',
    }
    const ages: Record<string, number | null | undefined> = {
      'src/panel.ts': times.source,
      'lib/types/client/index.d.ts': times.declaration,
      'lib/client.js': times.runtime,
    }
    mkdirSync(join(dir, 'src'), { recursive: true })
    mkdirSync(join(dir, 'lib/types/client'), { recursive: true })
    for (const [rel, content] of Object.entries(files)) {
      const age = ages[rel]
      if (age === null) continue
      const path = join(dir, rel)
      writeFileSync(path, content)
      if (age !== undefined) {
        const when = new Date(Date.now() - age * 1000)
        utimesSync(path, when, when)
      }
    }
  }

  it('reports a runtime bundle older than its own client declarations', () => {
    writePackage('dsh-client-ui-chat', { source: 300, declaration: 200, runtime: 400 })
    const found = collectArtifactProblems(tree, ['@deepseek-ai/dsh-client-ui-chat/client'])
    expect(found.staleRuntime.map((entry) => entry.name)).toEqual([
      '@deepseek-ai/dsh-client-ui-chat',
    ])
    expect(found.staleRuntime[0]?.runtime).toBe('packages/client/dsh-client-ui-chat/lib/client.js')
    // Fresh declarations keep the declarations-vs-src axis quiet.
    expect(found.stale).toEqual([])
    expect(found.missing).toEqual([])
  })

  it('accepts a runtime bundle built after its declarations', () => {
    writePackage('dsh-client-ui-chat', { source: 300, declaration: 200, runtime: 100 })
    const found = collectArtifactProblems(tree, ['@deepseek-ai/dsh-client-ui-chat/client'])
    expect(found.staleRuntime).toEqual([])
  })

  it('reports declarations older than their source', () => {
    writePackage('dsh-client-ui-chat', { source: 100, declaration: 200, runtime: 50 })
    const found = collectArtifactProblems(tree, ['@deepseek-ai/dsh-client-ui-chat/client'])
    expect(found.stale).toEqual(['@deepseek-ai/dsh-client-ui-chat/client'])
  })

  it('ignores packages that serve no client arm', () => {
    // A host-only package has no browser face: its `lib/index.js` is never
    // loaded into the page, so a stale one is a host concern rather than a
    // client-contract break. Reporting it would train the reader to ignore
    // the gate. Here its declaration is also absent, which is the honest
    // report: the import cannot be resolved at all.
    const dir = join(tree, 'packages/core/dsh-tools')
    mkdirSync(join(dir, 'src'), { recursive: true })
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({
        name: '@deepseek-ai/dsh-tools',
        exports: { '.': { types: './lib/types/index.d.ts', default: './lib/index.js' } },
      }),
    )
    const found = collectArtifactProblems(tree, ['@deepseek-ai/dsh-tools'])
    expect(found.staleRuntime).toEqual([])
    expect(found.missing).toEqual(['@deepseek-ai/dsh-tools'])
  })

  it('reports a missing declaration as missing rather than stale', () => {
    writePackage('dsh-client-ui-chat', { source: 100, declaration: null, runtime: 50 })
    const found = collectArtifactProblems(tree, ['@deepseek-ai/dsh-client-ui-chat/client'])
    expect(found.missing).toEqual(['@deepseek-ai/dsh-client-ui-chat/client'])
    expect(found.staleRuntime).toEqual([])
  })

  it('reports a specifier with no sibling package as outside', () => {
    writePackage('dsh-client-ui-chat', { source: 300, declaration: 200, runtime: 100 })
    const found = collectArtifactProblems(tree, [
      '@deepseek-ai/dsh-client-ui-chat/client',
      '@deepseek-ai/dsh-not-in-tree',
    ])
    expect(found.outside).toEqual(['@deepseek-ai/dsh-not-in-tree'])
  })

  it('reports one entry per package however many of its faces are imported', () => {
    writePackage('dsh-client-ui-chat', { source: 300, declaration: 200, runtime: 400 })
    const dir = join(tree, 'packages/client/dsh-client-ui-chat')
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({
        name: '@deepseek-ai/dsh-client-ui-chat',
        exports: {
          './client': { types: './lib/types/client/index.d.ts', default: './lib/client.js' },
          '.': { types: './lib/types/client/index.d.ts', default: './lib/client.js' },
        },
      }),
    )
    const found = collectArtifactProblems(tree, [
      '@deepseek-ai/dsh-client-ui-chat',
      '@deepseek-ai/dsh-client-ui-chat/client',
    ])
    expect(found.staleRuntime).toHaveLength(1)
  })
})

describe('resolveHarnessRoot', () => {
  it('resolves relative to root when DSH_HARNESS_ROOT is unset', () => {
    const orig = process.env.DSH_HARNESS_ROOT
    delete process.env.DSH_HARNESS_ROOT
    try {
      expect(resolveHarnessRoot('/tmp/zotero')).toBe('/tmp/deepseek-harness')
    } finally {
      if (orig !== undefined) process.env.DSH_HARNESS_ROOT = orig
    }
  })

  it('respects DSH_HARNESS_ROOT when set', () => {
    const orig = process.env.DSH_HARNESS_ROOT
    process.env.DSH_HARNESS_ROOT = '/custom/harness'
    try {
      expect(resolveHarnessRoot('/tmp/zotero')).toBe('/custom/harness')
    } finally {
      if (orig !== undefined) process.env.DSH_HARNESS_ROOT = orig
      else delete process.env.DSH_HARNESS_ROOT
    }
  })
})
