/** Release branch guard and workflow dependency contracts. */

import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { assertReleaseSource } from '../../scripts/release-branch-guard.mjs'

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
    new URL('../../.github/workflows/release-branch.yml', import.meta.url),
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
})
