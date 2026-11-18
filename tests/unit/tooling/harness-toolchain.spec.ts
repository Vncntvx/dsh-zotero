import { expect, it } from 'vitest'
import {
  installCommand,
  pnpmVersion,
  readHarnessToolchain,
} from '../../../scripts/harness-toolchain.mjs'
import snapshot from '../../fixtures/harness-toolchain-pin.json' with { type: 'json' }

const pin = snapshot.pin.slice('dsh-v'.length)

it('builds the registry-only install command from the current pin snapshot', () => {
  expect(readHarnessToolchain('/absent/sibling', pin)).toEqual(snapshot)
  expect(installCommand(pin, snapshot)).toBe(
    `npm install --global @deepseek-ai/dsh@${pin} ${snapshot.packageManager.split('+')[0]}`,
  )
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
  expect(() => installCommand('99.0.0', snapshot)).toThrow('snapshot is not for')
  expect(() => installCommand(pin, { ...snapshot, commit: '' })).toThrow('source commit')
})
