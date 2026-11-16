/** The shipped command resolves under Node without the test loader. */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { withTempDir } from '../../helpers/temp-dir.js'

const run = promisify(execFile)
const script = fileURLToPath(new URL('../../../scripts/fetch-semantic-model.mjs', import.meta.url))
describe('native model CLI', () => {
  it('lists the real catalog without a custom resolver or network', async () => {
    const result = await run(process.execPath, [script, '--list'], { timeout: 5000 })
    expect(result.stdout).toContain('balanced')
    expect(result.stdout).toContain('academic')
    expect(result.stderr).toBe('')
  })
  it('verifies an empty isolated installation without reading the user model directory', async () => {
    await withTempDir(async (root) => {
      const result = await run(process.execPath, [script, '--verify-only', `--dir=${root}`], {
        timeout: 5000,
      })
      expect(result.stdout).toContain('(0 files verified)')
    })
  })
})
