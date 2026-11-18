/** Release branch guard and workflow dependency contracts. */

import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { load } from 'js-yaml'
import { expect, it } from 'vitest'
import { withTempDir } from '../../helpers/temp-dir.js'
import {
  assertReleaseAdvance,
  assertReleaseSource,
  assertReleaseTarget,
} from '../../../scripts/release-branch-guard.mjs'

function readReleaseWorkflow() {
  return readFileSync(
    new URL('../../../.github/workflows/release-branch.yml', import.meta.url),
    'utf8',
  )
}

function installMatrixSteps() {
  const workflow = load(readReleaseWorkflow()) as {
    jobs: Record<
      string,
      { steps: { uses?: string; with?: Record<string, string>; run?: string; if?: string }[] }
    >
  }
  return workflow.jobs['web-composition']!.steps
}

it('rejects a source SHA drift before a release ref can move', () => {
  expect(() =>
    assertReleaseSource({ actualSha: 'actual', expectedSha: 'checked', status: '' }),
  ).toThrow('does not match checked source')
})

it('rejects tracked worktree changes before a release ref can move', () => {
  expect(() =>
    assertReleaseSource({
      actualSha: 'checked',
      expectedSha: 'checked',
      status: ' M src/index.ts',
    }),
  ).toThrow('dirty worktree')
})

it('keeps publishing behind both mandatory release jobs', () => {
  const workflow = readReleaseWorkflow()
  expect(workflow).toContain('quality-gate:')
  expect(workflow).toContain('web-composition:')
  expect(workflow).toMatch(/publish:[\s\S]*needs:\n\s+- quality-gate\n\s+- web-composition/)
  expect(workflow).toContain('npm run release:check')
  expect(workflow).toContain('npm run smoke:web-composition')
  // The smoke needs a dsh CLI; CI has no sibling checkout, so the job installs
  // the published CLI from an isolated consumer lockfile at the pinned version.
  expect(workflow).toContain('node scripts/harness-toolchain.mjs')
  const publish = workflow.slice(workflow.indexOf('  publish:'))
  expect(publish).not.toMatch(/npm (?:ci|install|run build)/)
  expect(publish).toContain('--artifact "$RUNNER_TEMP/release-artifact"')
  expect(publish).toContain('RELEASE_PUSH_TOKEN: ${{ github.token }}')
  expect(workflow).toContain('persist-credentials: false')
  expect(workflow).toContain('needs: quality-gate')
  expect(workflow).toContain('--tarball "$tarball"')
})

it('gates npm publication on a version tag with OIDC and the verified artifact', () => {
  const workflow = readReleaseWorkflow()
  const start = workflow.indexOf('  npm-release:')
  expect(start).toBeGreaterThanOrEqual(0)
  const job = workflow.slice(start, workflow.indexOf('  publish:', start))
  expect(job).toContain("if: github.event_name == 'push' && startsWith(github.ref, 'refs/tags/v')")
  expect(job).toContain('id-token: write')
  expect(job).toContain('contents: write')
  expect(job).toContain('needs:\n      - quality-gate\n      - web-composition')
  // OIDC mints short-lived publish tokens instead of stored credentials.
  expect(job).not.toMatch(/NPM_TOKEN|NODE_AUTH_TOKEN|secrets\./)
  expect(job).toContain('registry-url:')
  expect(job).toContain('package-manager-cache: false')
  expect(job).toContain('--verify')
  expect(job).toContain('npm publish "$TARBALL" --access public --tag "$NPM_DIST_TAG"')
  expect(job).toContain('release_flags+=(--prerelease --latest=false)')
  expect(job).toContain('"${release_flags[@]}"')
  expect(job).toContain("if: env.PUBLISH_NEEDED == 'true'")
  expect(job).toContain('scripts/npm-registry.mjs --check')
  expect(job).toContain('scripts/npm-registry.mjs --verify')
  expect(job.indexOf('scripts/npm-registry.mjs --verify')).toBeLessThan(
    job.indexOf('gh release create'),
  )
  expect(job).toContain('gh release create')
  // Republishes the exact verified tarball without rebuilding.
  expect(job).not.toMatch(/npm (?:ci|install|run build)/)
})

it.each([
  ['1.3.0', 'latest', 'false'],
  ['1.3.0-alpha.1', 'alpha', 'true'],
  ['1.3.0-beta.2', 'beta', 'true'],
  ['1.3.0-rc.1', 'rc', 'true'],
  ['1.3.0-1', 'next', 'true'],
  ['1.3.0-latest.1', 'next', 'true'],
])('selects the publication channel for %s', async (version, distTag, prerelease) => {
  const workflow = load(readReleaseWorkflow()) as {
    jobs: Record<string, { steps: { name?: string; run?: string }[] }>
  }
  const script = workflow.jobs['npm-release']!.steps.find(
    (step) => step.name === 'Select publication channel',
  )!.run!
  await withTempDir(async (root) => {
    const envFile = join(root, 'github-env')
    execFileSync('bash', ['-e', '-o', 'pipefail', '-c', script], {
      env: { ...process.env, VERSION: version, GITHUB_ENV: envFile },
    })
    expect(readFileSync(envFile, 'utf8')).toBe(
      `NPM_DIST_TAG=${distTag}\nPRERELEASE=${prerelease}\n`,
    )
  })
})

it('installs the same artifact on all desktop platforms before publication', () => {
  const workflow = readReleaseWorkflow()
  const job = workflow.slice(
    workflow.indexOf('  web-composition:'),
    workflow.indexOf('  npm-release:'),
  )
  expect(job).toContain('os: [ubuntu-latest, macos-latest, windows-latest]')
  expect(job).toContain('fail-fast: false')
  expect(job).toContain('node scripts/harness-toolchain.mjs')
  expect(job).toContain('--install-only --tarball "$tarball"')
  expect(job).toContain('DSH_CLI: ${{ steps.harness-toolchain.outputs.dsh-cli }}')
  expect(job).toContain('--dsh "$DSH_CLI"')
  expect(job).toContain('if: failure()')
  expect(job).not.toContain('--ignore-scripts --tarball')
})

it('keys the install matrix npm cache on both dependency locks', () => {
  const setup = installMatrixSteps().find((step) => step.uses?.startsWith('actions/setup-node@'))
  expect(setup?.with).toMatchObject({
    cache: 'npm',
    'cache-dependency-path':
      'package-lock.json\ntests/fixtures/dsh-cli-consumer/package-lock.json\n',
  })
})

it('installs repository development dependencies only for the Linux browser smoke', () => {
  const install = installMatrixSteps().find((step) => step.run === 'npm ci --ignore-scripts')
  expect(install?.if).toBe("runner.os == 'Linux'")
})

it.each([
  { branch: 'release', remote: 'origin', remoteUrl: 'https://github.com/Vncntvx/dsh-zotero' },
  { branch: 'release', remote: 'origin', remoteUrl: 'https://github.com/Vncntvx/dsh-zotero.git' },
  { branch: 'release', remote: 'origin', remoteUrl: 'https://github.com/Vncntvx/dsh-zotero/' },
  { branch: 'release', remote: 'origin', remoteUrl: 'https://github.com/Vncntvx/dsh-zotero.git/' },
  { branch: 'release', remote: 'origin', remoteUrl: 'git@github.com:Vncntvx/dsh-zotero' },
  { branch: 'release', remote: 'origin', remoteUrl: 'git@github.com:Vncntvx/dsh-zotero.git' },
  { branch: 'release', remote: 'origin', remoteUrl: 'ssh://git@github.com/Vncntvx/dsh-zotero' },
  { branch: 'release', remote: 'origin', remoteUrl: 'ssh://git@github.com/Vncntvx/dsh-zotero.git' },
])('accepts a reviewed canonical release target: $branch $remote $remoteUrl', (target) => {
  expect(() => assertReleaseTarget(target)).not.toThrow()
})

it.each([
  { branch: 'main', remote: 'origin', remoteUrl: 'https://github.com/Vncntvx/dsh-zotero.git' },
  { branch: 'release', remote: 'fork', remoteUrl: 'https://github.com/Vncntvx/dsh-zotero.git' },
  { branch: 'release', remote: 'origin', remoteUrl: 'https://github.com/attacker/dsh-zotero.git' },
])('refuses an unreviewed release target: $branch $remote $remoteUrl', (target) => {
  expect(() => assertReleaseTarget(target)).toThrow()
})

it('accepts a forward source change but refuses history rollback and rebuilt source bytes', () => {
  const previous = { sourceSha: 'old', artifactDigest: 'old-bytes' }
  const request = {
    sourceSha: 'new',
    mainSha: 'new',
    previous,
    sourceDescendsFromPrevious: true,
    artifactDigest: 'new-bytes',
  }
  expect(() => assertReleaseAdvance(request)).not.toThrow()
  expect(() => assertReleaseAdvance({ ...request, sourceDescendsFromPrevious: false })).toThrow(
    'backwards',
  )
  expect(() => assertReleaseAdvance({ ...request, sourceSha: 'old' })).toThrow(
    'different release bytes',
  )
  expect(() =>
    assertReleaseAdvance({ ...request, previous: undefined, sourceSha: 'stale' }),
  ).toThrow('current main')
})

it('keeps the upstream-health workflow resilient to direct dependency drift', () => {
  const workflow = readFileSync(
    new URL('../../../.github/workflows/upstream-health.yml', import.meta.url),
    'utf8',
  )
  const dependencyStep = workflow.slice(
    workflow.indexOf('- name: Check direct dependency releases'),
    workflow.indexOf('- name: Check upstream registry updates'),
  )
  const registryStep = workflow.slice(workflow.indexOf('- name: Check upstream registry updates'))
  // Dependency drift is informational; the registry comparison must still run
  // after it so a failing deps:check cannot leave the weekly report silent.
  expect(dependencyStep).toContain('continue-on-error: true')
  expect(registryStep).toContain('if: always()')
  expect(registryStep).not.toContain('continue-on-error')
})
