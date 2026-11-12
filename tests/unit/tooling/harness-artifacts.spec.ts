/**
 * Artifact resolution provenance: a registry install is judged by its own
 * declarations and its version, while a sibling checkout linked into
 * `node_modules` is still judged by its build freshness. The import scan reads
 * the same trees the guards read, so its two readings of each file are what
 * keep a spec's counter-example out of the dependency list.
 * @module tests/unit/harness-artifacts
 */

import { mkdirSync, mkdtempSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { collectArtifactProblems, importedSpecifiers } from '../../../scripts/harness-state.mjs'

describe('artifact resolution provenance', () => {
  let checkout: string
  let installed: string

  beforeEach(() => {
    checkout = mkdtempSync(join(tmpdir(), 'dsh-harness-checkout-'))
    installed = mkdtempSync(join(tmpdir(), 'dsh-harness-installed-'))
  })

  afterEach(() => {
    rmSync(checkout, { recursive: true, force: true })
    rmSync(installed, { recursive: true, force: true })
  })

  /** One package in the sibling checkout, with the ages each case asserts on. */
  function writeSiblingPackage(name: string, source: number, declaration: number): void {
    const dir = join(checkout, 'packages/client', name)
    mkdirSync(join(dir, 'src'), { recursive: true })
    mkdirSync(join(dir, 'lib/types/client'), { recursive: true })
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({
        name: `@deepseek-ai/${name}`,
        exports: { './client': { types: './lib/types/client/index.d.ts' } },
      }),
    )
    const files: Record<string, number> = {
      'src/panel.ts': source,
      'lib/types/client/index.d.ts': declaration,
    }
    for (const [rel, age] of Object.entries(files)) {
      const path = join(dir, rel)
      writeFileSync(path, 'export declare const panel: number\n')
      const when = new Date(Date.now() - age * 1000)
      utimesSync(path, when, when)
    }
  }

  /** The registry copy typecheck resolves through `node_modules`. */
  function writeInstalledPackage(name: string, version: string): string {
    const dir = join(installed, '@deepseek-ai', name)
    mkdirSync(join(dir, 'lib/types/client'), { recursive: true })
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({
        name: `@deepseek-ai/${name}`,
        version,
        exports: { './client': { types: './lib/types/client/index.d.ts' } },
      }),
    )
    writeFileSync(join(dir, 'lib/types/client/index.d.ts'), 'export declare const panel: number\n')
    return dir
  }

  it('judges a registry install by its own declarations, not the sibling build', () => {
    // The sibling checkout carries a stale build, which would be a problem if
    // typecheck resolved it. It does not: `node_modules` holds the pin's copy.
    writeSiblingPackage('dsh-client-ui-chat', 100, 200)
    writeInstalledPackage('dsh-client-ui-chat', '0.2.2-rc.1')
    const found = collectArtifactProblems(
      checkout,
      ['@deepseek-ai/dsh-client-ui-chat/client'],
      undefined,
      installed,
    )
    expect(found.stale).toEqual([])
    expect(found.registry.map((entry) => entry.name)).toEqual(['@deepseek-ai/dsh-client-ui-chat'])
    expect(found.missing).toEqual([])
  })

  it('still judges a sibling checkout linked into node_modules', () => {
    writeSiblingPackage('dsh-client-ui-chat', 100, 200)
    const link = join(installed, '@deepseek-ai/dsh-client-ui-chat')
    mkdirSync(dirname(link), { recursive: true })
    symlinkSync(join(checkout, 'packages/client/dsh-client-ui-chat'), link, 'dir')
    const found = collectArtifactProblems(
      checkout,
      ['@deepseek-ai/dsh-client-ui-chat/client'],
      undefined,
      installed,
    )
    expect(found.stale).toEqual(['@deepseek-ai/dsh-client-ui-chat/client'])
    expect(found.registry).toEqual([])
  })

  it('reports a missing declaration in the installed copy', () => {
    writeSiblingPackage('dsh-client-ui-chat', 300, 200)
    mkdirSync(join(installed, '@deepseek-ai/dsh-client-ui-chat'), { recursive: true })
    const found = collectArtifactProblems(
      checkout,
      ['@deepseek-ai/dsh-client-ui-chat/client'],
      undefined,
      installed,
    )
    expect(found.missing).toEqual(['@deepseek-ai/dsh-client-ui-chat/client'])
  })

  it('never reports a specifier that only appears inside a string fixture', () => {
    // The focus gate's own spec spells imports out inside template literals.
    // The scan reads the same tree, so the two readings must agree that those
    // are fixtures, not dependencies.
    expect(importedSpecifiers().length).toBeGreaterThan(0)
    expect(importedSpecifiers().filter((specifier) => specifier.includes('/src/'))).toEqual([])
  })
})
