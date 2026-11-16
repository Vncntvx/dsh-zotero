/** Release branch guard and workflow dependency contracts. */

import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import {
  assertReleaseAdvance,
  assertReleaseSource,
  assertReleaseTarget,
} from '../../../scripts/release-branch-guard.mjs'

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
  const workflow = readFileSync(
    new URL('../../../.github/workflows/release-branch.yml', import.meta.url),
    'utf8',
  )
  expect(workflow).toContain('quality-gate:')
  expect(workflow).toContain('web-composition:')
  expect(workflow).toMatch(/publish:[\s\S]*needs:\n\s+- quality-gate\n\s+- web-composition/)
  expect(workflow).toContain('npm run release:check')
  expect(workflow).toContain('npm run smoke:web-composition')
  // The smoke needs a dsh CLI; CI has no sibling checkout, so the job installs
  // the published CLI at the version the dev tree pins.
  expect(workflow).toContain('npm install --global "@deepseek-ai/dsh@')
  const publish = workflow.slice(workflow.indexOf('  publish:'))
  expect(publish).not.toMatch(/npm (?:ci|install|run build)/)
  expect(publish).toContain('--artifact "$RUNNER_TEMP/release-artifact"')
  expect(publish).toContain('RELEASE_PUSH_TOKEN: ${{ github.token }}')
  expect(workflow).toContain('persist-credentials: false')
  expect(workflow).toContain('needs: quality-gate')
  expect(workflow).toContain('--tarball "$tarball"')
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
