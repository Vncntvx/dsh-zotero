import { describe, expect, it } from 'vitest'
import { collectProxyUndiciProblems } from '../../../scripts/harness-state.mjs'

describe('collectProxyUndiciProblems', () => {
  const proxy = 'node_modules/@deepseek-ai/dsh-http-proxy'
  const undici = 'node_modules/undici'
  const manifest = { dependencies: { undici: '8.11.2' } }
  const packages = {
    '': manifest,
    [proxy]: { dependencies: { undici: '8.11.2' } },
    [undici]: { version: '8.11.2' },
  }

  it('accepts one shared runtime copy alongside unrelated test dependencies', () => {
    expect(
      collectProxyUndiciProblems(
        { packages: { ...packages, ['node_modules/jsdom/' + undici]: { version: '8.12.4' } } },
        manifest,
      ),
    ).toEqual([])
  })

  it('rejects duplicate paths even when both versions match', () => {
    expect(
      collectProxyUndiciProblems(
        { packages: { ...packages, [proxy + '/' + undici]: packages[undici] } },
        manifest,
      ),
    ).toEqual([expect.stringContaining('share one lockfile entry')])
  })

  it('rejects a plugin range or missing exact proxy requirement', () => {
    expect(
      collectProxyUndiciProblems({ packages }, { dependencies: { undici: '^8.11.2' } }),
    ).toHaveLength(1)
    expect(collectProxyUndiciProblems({ packages: {} }, manifest)).toEqual([
      expect.stringContaining('must declare an exact undici dependency'),
    ])
  })
})
