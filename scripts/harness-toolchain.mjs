import { execFileSync, execSync } from 'node:child_process'
import { appendFileSync, copyFileSync, existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveHarnessRoot } from './shared/harness-packages.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export const toolchainFixture = new URL(
  '../tests/fixtures/harness-toolchain-pin.json',
  import.meta.url,
)
const consumerDir = join(root, 'tests', 'fixtures', 'dsh-cli-consumer')
export const consumerManifestPath = join(consumerDir, 'package.json')
export const consumerLockPath = join(consumerDir, 'package-lock.json')

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

/** The consumer dependency versions one pin snapshot requires. */
export function consumerDependencies(pin, fixture) {
  if (!pinPattern.test(pin) || fixture?.pin !== `dsh-v${pin}`)
    throw new Error(`Harness toolchain snapshot is not for dsh-v${pin}`)
  if (typeof fixture.commit !== 'string' || !/^[a-f0-9]{40}$/.test(fixture.commit))
    throw new Error('Harness toolchain snapshot lacks a valid source commit')
  return { '@deepseek-ai/dsh': pin, pnpm: pnpmVersion(fixture.packageManager) }
}

/**
 * Report every disagreement between the isolated consumer manifest/lockfile
 * and one harness pin. Reads only the passed-in data.
 * @param manifest - parsed tests/fixtures/dsh-cli-consumer/package.json.
 * @param lock - parsed tests/fixtures/dsh-cli-consumer/package-lock.json.
 * @param pin - the exact harness version.
 * @param fixture - the committed pin snapshot.
 * @returns human-readable problems; empty when every consumer fact agrees.
 */
export function consumerProblems(manifest, lock, pin, fixture) {
  const expected = consumerDependencies(pin, fixture)
  const packages = lock?.packages ?? {}
  const declared = manifest?.dependencies ?? {}
  const locked = packages['']?.dependencies ?? {}
  const found = []
  const check = (where, actual, wanted) => {
    if (actual !== wanted) found.push(`${where} is "${actual ?? 'missing'}", expected "${wanted}"`)
  }
  check(
    'consumer manifest dependencies["@deepseek-ai/dsh"]',
    declared['@deepseek-ai/dsh'],
    expected['@deepseek-ai/dsh'],
  )
  check('consumer manifest dependencies.pnpm', declared.pnpm, expected.pnpm)
  check(
    'consumer lockfile root dependencies["@deepseek-ai/dsh"]',
    locked['@deepseek-ai/dsh'],
    expected['@deepseek-ai/dsh'],
  )
  check('consumer lockfile root dependencies.pnpm', locked.pnpm, expected.pnpm)
  check(
    'consumer lockfile resolution @deepseek-ai/dsh',
    packages['node_modules/@deepseek-ai/dsh']?.version,
    expected['@deepseek-ai/dsh'],
  )
  check('consumer lockfile resolution pnpm', packages['node_modules/pnpm']?.version, expected.pnpm)
  if (found.length > 0)
    found.push(
      'refresh with: npm install --package-lock-only --prefix tests/fixtures/dsh-cli-consumer',
    )
  return found
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
  consumerDependencies(pin, snapshot)
  return snapshot
}

export function readHarnessToolchain(harnessRoot, pin) {
  const snapshot = JSON.parse(readFileSync(toolchainFixture, 'utf8'))
  consumerDependencies(pin, snapshot)
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

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const manifest = readJson(join(root, 'package.json'))
  const pin = manifest.devDependencies['@deepseek-ai/dsh-api-remotes']
  const snapshot = readHarnessToolchain(resolveHarnessRoot(root), pin)
  const problems = consumerProblems(
    readJson(consumerManifestPath),
    readJson(consumerLockPath),
    pin,
    snapshot,
  )
  if (problems.length > 0)
    throw new Error(`Consumer toolchain drifts from the pin ${pin}:\n${problems.join('\n')}`)
  const installDir = mkdtempSync(join(process.env.RUNNER_TEMP ?? tmpdir(), 'dsh-cli-consumer-'))
  copyFileSync(consumerManifestPath, join(installDir, 'package.json'))
  copyFileSync(consumerLockPath, join(installDir, 'package-lock.json'))
  console.log(`Release smoke consumer: ${installDir}`)
  execSync('npm ci --no-audit --no-fund --timing --logs-dir=npm-logs', {
    cwd: installDir,
    stdio: 'inherit',
  })

  const dshHome = join(installDir, 'node_modules', '@deepseek-ai', 'dsh')
  const installedDsh = readJson(join(dshHome, 'package.json')).version
  const installedPnpm = readJson(join(installDir, 'node_modules', 'pnpm', 'package.json')).version
  const expected = consumerDependencies(pin, snapshot)
  if (installedDsh !== expected['@deepseek-ai/dsh'] || installedPnpm !== expected.pnpm)
    throw new Error(
      `Expected dsh ${expected['@deepseek-ai/dsh']} and pnpm ${expected.pnpm},` +
        ` got dsh ${installedDsh} and pnpm ${installedPnpm}`,
    )
  console.log(`Release smoke toolchain: dsh ${installedDsh}, pnpm ${installedPnpm}`)
  const { GITHUB_OUTPUT, GITHUB_PATH } = process.env
  if (GITHUB_OUTPUT)
    appendFileSync(
      GITHUB_OUTPUT,
      `dsh-cli=${join(dshHome, 'lib', 'bin.js')}\npnpm-version=${installedPnpm}\n`,
    )
  if (GITHUB_PATH) appendFileSync(GITHUB_PATH, `${join(installDir, 'node_modules', '.bin')}\n`)
}
