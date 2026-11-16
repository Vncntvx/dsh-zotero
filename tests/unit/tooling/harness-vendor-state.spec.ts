/** Vendor floors and override refusals remain effective in standalone CI. */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { collectVendorProblems } from '../../../scripts/harness-state.mjs'

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

  it('refuses a vendor override even when CI has no sibling checkout', () => {
    expect(
      collectVendorProblems(join(tree, 'missing-harness'), {
        overrides: { '@deepseek-ai/cordis': '4.0.5' },
      }),
    ).toEqual([expect.stringContaining('drop the override')])
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
