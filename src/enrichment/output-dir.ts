/**
 * Resolve and validate the directory parsed artifacts are written to.
 *
 * The default is the harness user-data root (`dshHomePath('zotero-parsed')`),
 * resolved at runtime so a home relocation does not strand stored state. The
 * validation rule set (absolute, resolvable, a real writable directory, no
 * sensitive or symlink-escaped path, compared in canonical space on both
 * sides) lives in `safe-directory.ts` and is shared with the semantic-model
 * directory; this wrapper only pins the default root, the creation policy —
 * a configured path must already exist, the default is created — and the
 * error code.
 * @module dsh-zotero/enrichment/output-dir
 */

import { access, mkdir, realpath, stat } from 'node:fs/promises'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import { ZOTERO_ENRICHMENT_OUTPUT_INVALID } from '../errors.js'
import { resolveSafeDirectory, type SafeDirectoryDeps } from './safe-directory.js'

/** Filesystem seams, injectable so unit tests never touch the real disk. */
export type OutputDirDeps = SafeDirectoryDeps

export const hostDeps: OutputDirDeps = {
  realpath,
  stat,
  access,
  mkdir: async (path) => {
    await mkdir(path, { recursive: true })
  },
}

/**
 * Resolve the output directory, creating it when needed.
 * @param configured - the configured path; empty means the default.
 * @param deps - filesystem seams (defaults to the real host).
 * @returns the absolute, validated directory path.
 * @throws {ZoteroError} `ZOTERO_ENRICHMENT_OUTPUT_INVALID` for any unsafe value.
 */
export async function resolveOutputDir(
  configured: string,
  deps: OutputDirDeps = hostDeps,
): Promise<string> {
  return await resolveSafeDirectory({
    configured,
    defaultRoot: dshHomePath('zotero-parsed'),
    create: false,
    errorCode: ZOTERO_ENRICHMENT_OUTPUT_INVALID,
    label: 'enrichment output directory',
    deps,
  })
}
