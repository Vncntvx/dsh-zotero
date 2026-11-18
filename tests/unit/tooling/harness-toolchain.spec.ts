import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import {
  consumerDependencies,
  consumerLockPath,
  consumerManifestPath,
  consumerProblems,
  pnpmVersion,
  readHarnessToolchain,
} from '../../../scripts/harness-toolchain.mjs'
import snapshot from '../../fixtures/harness-toolchain-pin.json' with { type: 'json' }

const pin = snapshot.pin.slice('dsh-v'.length)

it('accepts a consumer manifest and lockfile at the current pin', () => {
  expect(readHarnessToolchain('/absent/sibling', pin)).toEqual(snapshot)
  const manifest = JSON.parse(readFileSync(consumerManifestPath, 'utf8'))
  const lock = JSON.parse(readFileSync(consumerLockPath, 'utf8'))
  expect(consumerProblems(manifest, lock, pin, snapshot)).toEqual([])
})

it('reports every consumer fact that drifts from the pin', () => {
  const drifted = { '@deepseek-ai/dsh': '0.0.1', pnpm: '11.0.0' }
  const problems = consumerProblems(
    { dependencies: drifted },
    {
      packages: {
        '': { dependencies: drifted },
        'node_modules/@deepseek-ai/dsh': { version: '0.0.1' },
        'node_modules/pnpm': { version: '11.0.0' },
      },
    },
    pin,
    snapshot,
  ).join('\n')
  expect(problems).toContain('consumer manifest dependencies["@deepseek-ai/dsh"]')
  expect(problems).toContain('consumer lockfile root dependencies.pnpm')
  expect(problems).toContain('consumer lockfile resolution pnpm')
  expect(problems).toContain('npm install --package-lock-only')
})

it('extracts an exact pnpm version from a hashed packageManager declaration', () => {
  expect(pnpmVersion('pnpm@12.1.0-rc.2+sha512.abc123')).toBe('12.1.0-rc.2')
})

it.each([undefined, 'npm@11.10.0', 'pnpm@latest', 'pnpm@^11.0.0', 'pnpm@11.0.0;exit'])(
  'rejects an invalid toolchain declaration: %s',
  (value) => {
    expect(() => pnpmVersion(value)).toThrow('exact pnpm version')
  },
)

it('rejects a stale pin or missing provenance', () => {
  expect(() => consumerDependencies('99.0.0', snapshot)).toThrow('snapshot is not for')
  expect(() => consumerDependencies(pin, { ...snapshot, commit: '' })).toThrow('source commit')
})
