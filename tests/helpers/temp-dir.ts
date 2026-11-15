/**
 * Run an assertion against a temporary directory cleaned afterwards.
 * @module tests/helpers/temp-dir
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export async function withTempDir(
  run: (dir: string) => Promise<void>,
  prefix = 'dsh-test-',
): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  try {
    await run(dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}
