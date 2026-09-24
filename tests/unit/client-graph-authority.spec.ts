/**
 * Client-graph authority unit rules: the browser bundle may only contain
 * client-safe local sources and platform modules. Host codecs, the Typert
 * manifest, zod, and schemastery must fail at resolve time or via the
 * metafile allowlist.
 * @module tests/unit/client-graph-authority
 */

import { describe, expect, it } from 'vitest'
import * as esbuild from 'esbuild'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  createClientAuthorityPlugin,
  clientGraphViolations,
  isInlineSafeHarness,
} from '../../scripts/client-graph-authority.mjs'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../..')

function metafileOf(paths: readonly string[]) {
  const inputs: Record<string, { bytes: number }> = {}
  for (const path of paths) inputs[path] = { bytes: 1 }
  return inputs
}

function authorityBuild(contents: string) {
  return esbuild.build({
    stdin: {
      contents,
      resolveDir: join(repoRoot, 'src/client'),
      loader: 'ts',
    },
    bundle: true,
    write: false,
    format: 'cjs',
    platform: 'browser',
    target: 'es2022',
    jsx: 'automatic',
    metafile: true,
    external: ['react', 'react/jsx-runtime'],
    plugins: [createClientAuthorityPlugin()],
  })
}

describe('client graph authority', () => {
  it('allows client-safe local sources and ignores non-src inputs', () => {
    const violations = clientGraphViolations(
      metafileOf([
        'src/client/index.ts',
        'src/client/status-codec.ts',
        'src/contract.ts',
        'src/settings-namespace.ts',
        'src/json.ts',
        'src/ref-grammar.ts',
        'src/export-items.ts',
        'node_modules/react/index.js',
      ]),
    )
    expect(violations).toEqual([])
  })

  it('rejects host-local modules even without zod path comments', () => {
    const violations = clientGraphViolations(
      metafileOf(['src/status-codec.ts', 'src/typert.ts', 'src/remote.ts', 'src/service.ts']),
    )
    expect(violations.map((entry) => entry.key).sort()).toEqual([
      'src/remote.ts',
      'src/service.ts',
      'src/status-codec.ts',
      'src/typert.ts',
    ])
    expect(violations.every((entry) => entry.kind === 'host-local')).toBe(true)
  })

  it('rejects zod package inputs', () => {
    const violations = clientGraphViolations(
      metafileOf(['src/client/index.ts', 'node_modules/zod/v4/classic/external.js']),
    )
    expect(violations).toHaveLength(1)
    expect(violations[0]).toMatchObject({ kind: 'host-package' })
    expect(violations[0]!.key).toContain('node_modules/zod')
  })

  it('rejects schemastery package inputs', () => {
    const violations = clientGraphViolations(
      metafileOf(['src/client/index.ts', 'node_modules/@deepseek-ai/schemastery/lib/index.js']),
    )
    expect(violations).toHaveLength(1)
    expect(violations[0]).toMatchObject({ kind: 'host-package' })
    expect(violations[0]!.key).toContain('node_modules/@deepseek-ai/schemastery')
  })

  it('rejects a client graph that value-imports the host status codec', async () => {
    await expect(
      authorityBuild(
        `import { ZOTERO_INVOCATIONS } from '../status-codec.ts'\nexport default { apply() {}, inject: [], invocations: ZOTERO_INVOCATIONS }\n`,
      ),
    ).rejects.toThrow(/zod|status-codec|host-owned|client graph/i)
  })

  it('rejects a client graph that value-imports zod directly', async () => {
    await expect(
      authorityBuild(
        `import { z } from 'zod'\nexport default { apply() {}, inject: [], s: z.object({ a: z.string() }) }\n`,
      ),
    ).rejects.toThrow(/host-owned package "zod"|client graph/i)
  })

  it('rejects a client graph that value-imports schemastery directly', async () => {
    await expect(
      authorityBuild(
        `import Schema from '@deepseek-ai/schemastery'\nexport default { apply() {}, inject: [], s: Schema.string() }\n`,
      ),
    ).rejects.toThrow(/host-owned package "@deepseek-ai\/schemastery"|client graph/i)
  })

  it('allows the real client Remote contribution graph', async () => {
    const result = await authorityBuild(
      `import { ZOTERO_REMOTE } from './remote.ts'\nexport default { apply() {}, inject: [], remote: ZOTERO_REMOTE }\n`,
    )
    const violations = clientGraphViolations(result.metafile.inputs)
    expect(violations).toEqual([])
    const keys = Object.keys(result.metafile.inputs).map((key) => key.replaceAll('\\', '/'))
    expect(keys.some((key) => /src\/client\/remote\.(ts|js)$/.test(key))).toBe(true)
  })
})

describe('harness inline-safe table (dsh-v0.1.7-rc.1)', () => {
  it('accepts the rc.1 package names and rejects the retired agent-presets arm', () => {
    expect(isInlineSafeHarness('@deepseek-ai/dsh-agent-preset-registry/display')).toBe(true)
    expect(isInlineSafeHarness('@deepseek-ai/dsh-agent-presets/display')).toBe(false)
  })

  it('covers the full rc.1 INLINE_SAFE arms', () => {
    for (const specifier of [
      '@deepseek-ai/dsh-file-reference',
      '@deepseek-ai/dsh-session/client',
      '@deepseek-ai/dsh-llm',
      '@deepseek-ai/dsh-tools/types',
      '@deepseek-ai/dsh-brand',
      '@deepseek-ai/dsh-deque',
      '@deepseek-ai/dsh-output-retention',
      '@deepseek-ai/dsh-typert-protocol',
      '@deepseek-ai/dsh-util-crypto',
      '@deepseek-ai/dsh-util-values',
      '@deepseek-ai/dsh-util-workspace-path',
      '@deepseek-ai/dsh-token-meter/client',
      '@deepseek-ai/dsh-native-command/types',
      '@deepseek-ai/dsh-host-open-in-app/shared',
      '@deepseek-ai/dsh-plugin-manager/registry',
      '@deepseek-ai/dsh-spill-policy/notice',
      '@deepseek-ai/dsh-anything/remote',
      '@deepseek-ai/cosmokit',
      '@deepseek-ai/schemastery/utils',
    ]) {
      expect(isInlineSafeHarness(specifier), specifier).toBe(true)
    }
  })

  it('rejects platform / host packages that must stay external or host-only', () => {
    for (const specifier of [
      '@deepseek-ai/dsh-client-ui-chat',
      '@deepseek-ai/dsh-client-store',
      '@deepseek-ai/dsh-client-ui-primitives',
      'react',
      'zod',
    ]) {
      expect(isInlineSafeHarness(specifier), specifier).toBe(false)
    }
  })
})
