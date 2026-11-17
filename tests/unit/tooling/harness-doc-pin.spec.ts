/** The pin writer updates living examples and leaves historical versions alone. */
import { describe, expect, it } from 'vitest'
import {
  harnessDocPinProblems,
  harnessReviewProblems,
  withHarnessDocPin,
} from '../../../scripts/shared/harness-doc-pin.mjs'

describe('living installation pin', () => {
  it.each([
    [
      'README.md',
      '<a href="https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.2.2-rc.2"><img src="https://img.shields.io/badge/dsh-0.2.2--rc.2-blue"></a>',
    ],
    ['docs/getting-started.md', '宿主 dsh ≥ 0.2.2-rc.2；见历史发布。'],
    ['docs/skills.en.md', 'Use npm run harness:pin -- 0.2.2-rc.2.'],
  ])('updates %s and rejects an outdated marker', (path, text) => {
    expect(harnessDocPinProblems(path, text, '0.2.2-rc.3')).toHaveLength(1)
    const next = withHarnessDocPin(path, text, '0.2.2-rc.3')
    expect(next).toContain('0.2.2')
    expect(next).not.toContain('rc.2')
    if (path.includes('skills')) expect(next).toContain('rc.3.')
    expect(harnessDocPinProblems(path, next, '0.2.2-rc.3')).toEqual([])
    expect(withHarnessDocPin(path, next, '0.2.2-rc.3')).toBe(next)
  })
  it('refuses a missing marker instead of silently claiming the document was updated', () => {
    expect(harnessDocPinProblems('README.md', 'No badge', '0.2.2-rc.3')).toHaveLength(1)
  })

  it('rewrites both sides of the host engine range for a future pin', () => {
    const next = withHarnessDocPin(
      'docs/getting-started.en.md',
      'Host dsh `>=0.2.2-rc.3 <0.3.0`.',
      '9.9.9',
    )
    expect(next).toBe('Host dsh `>=9.9.9 <9.10.0`.')
    expect(
      harnessDocPinProblems('docs/getting-started.en.md', 'Host dsh `>=9.9.9 <10.0.0`.', '9.9.9'),
    ).toHaveLength(1)
  })
  it('requires explicit reviewed evidence when the harness pin changes', () => {
    const reviewed = '<!-- harness-reviewed: 0.2.2-rc.3 -->'
    expect(harnessReviewProblems('notes', reviewed, '0.2.2-rc.3')).toEqual([])
    expect(harnessReviewProblems('notes', reviewed, '9.9.9')).toHaveLength(1)
    expect(harnessReviewProblems('notes', 'no review record', '0.2.2-rc.3')).toHaveLength(1)
  })
})
