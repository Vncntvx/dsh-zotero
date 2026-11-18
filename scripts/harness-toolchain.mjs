import { execFileSync, execSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveHarnessRoot } from './shared/harness-packages.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export const toolchainFixture = new URL(
  '../tests/fixtures/harness-toolchain-pin.json',
  import.meta.url,
)
const exactVersion =
  '(?:0|[1-9]\\d*)\\.(?:0|[1-9]\\d*)\\.(?:0|[1-9]\\d*)(?:-[\\da-zA-Z]+(?:[.-][\\da-zA-Z]+)*)?'
const pinPattern = new RegExp(`^${exactVersion}$`)
const packageManagerPattern = new RegExp(
  `^pnpm@(${exactVersion})(?:\\+sha(?:224|256|384|512)\\.[a-fA-F0-9]+)?$`,
)

export function pnpmVersion(packageManager) {
  const version =
    typeof packageManager === 'string' && packageManagerPattern.exec(packageManager)?.[1]
  if (!version) throw new Error('Harness packageManager must specify an exact pnpm version')
  return version
}

export function installCommand(pin, fixture) {
  if (!pinPattern.test(pin) || fixture?.pin !== `dsh-v${pin}`)
    throw new Error(`Harness toolchain snapshot is not for dsh-v${pin}`)
  if (typeof fixture.commit !== 'string' || !/^[a-f0-9]{40}$/.test(fixture.commit))
    throw new Error('Harness toolchain snapshot lacks a valid source commit')
  return `npm install --global @deepseek-ai/dsh@${pin} pnpm@${pnpmVersion(fixture.packageManager)}`
}

function git(harnessRoot, args) {
  return execFileSync('git', ['-C', harnessRoot, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim()
}

export function extractHarnessToolchain(harnessRoot, pin) {
  const tag = `dsh-v${pin}`
  const commit = git(harnessRoot, ['rev-parse', '--verify', `${tag}^{commit}`])
  const { packageManager } = JSON.parse(git(harnessRoot, ['show', `${commit}:package.json`]))
  const snapshot = { pin: tag, commit, packageManager }
  installCommand(pin, snapshot)
  return snapshot
}

export function readHarnessToolchain(harnessRoot, pin) {
  const snapshot = JSON.parse(readFileSync(toolchainFixture, 'utf8'))
  installCommand(pin, snapshot)
  let commit
  if (existsSync(harnessRoot)) {
    try {
      commit = git(harnessRoot, ['rev-parse', '--verify', `${snapshot.pin}^{commit}`])
    } catch {}
  }
  if (commit) {
    const tagged = extractHarnessToolchain(harnessRoot, pin)
    if (snapshot.commit !== tagged.commit || snapshot.packageManager !== tagged.packageManager)
      throw new Error(`Harness toolchain snapshot disagrees with ${snapshot.pin}`)
  }
  return snapshot
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))
  const pin = manifest.devDependencies['@deepseek-ai/dsh-api-remotes']
  const snapshot = readHarnessToolchain(resolveHarnessRoot(root), pin)
  execSync(installCommand(pin, snapshot), { stdio: 'inherit' })
  const actual = execSync('pnpm --version', { encoding: 'utf8' }).trim()
  const expected = pnpmVersion(snapshot.packageManager)
  if (actual !== expected) throw new Error(`Expected pnpm ${expected}, got ${actual}`)
  console.log(`Release smoke toolchain: dsh ${pin}, pnpm ${actual}`)
}
