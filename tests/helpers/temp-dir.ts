/**
 * Run an assertion against a temporary directory cleaned afterwards.
 * @module tests/helpers/temp-dir
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * The physical test root. macOS reports tmpdir() as /var/folders/… behind the
 * /var → /private/var symlink; production guards compare realpath equality,
 * so fixtures must root at the physical path or discard and owner checks
 * observe a different filesystem than the assertions do.
 */
const TEST_ROOT = realpathSync(tmpdir())

/** For fixtures that exercise the production owner/ancestor checks. */
export function privateArtifactTestRoot(): string {
  return process.env.DSH_TEST_PRIVATE_ARTIFACT_ROOT ?? TEST_ROOT
}

export async function withTempDir(
  run: (dir: string) => Promise<void>,
  prefix = 'dsh-test-',
): Promise<void> {
  const dir = await mkdtemp(join(TEST_ROOT, prefix))
  try {
    await run(dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}
