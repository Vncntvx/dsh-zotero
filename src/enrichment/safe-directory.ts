/**
 * Domain-facing wrapper around the standalone safe-path resolver. The complete
 * candidate is validated before creation; reads can return a missing path.
 * @module dsh-zotero/enrichment/safe-directory
 */
import type { SafePathDeps, SafePathOptions } from './safe-directory-path.js'
import { hostSafePathDeps, resolveSafeDirectoryPath } from './safe-directory-path.js'
import { ZoteroError, type ZoteroErrorCode } from '../errors.js'

export type SafeDirectoryDeps = SafePathDeps
export const hostSafeDirectoryDeps: SafeDirectoryDeps = hostSafePathDeps

export interface SafeDirectoryOptions
  extends Omit<SafePathOptions, 'deps' | 'refuse'> {
  readonly errorCode: ZoteroErrorCode
  readonly label: string
  readonly deps?: SafeDirectoryDeps
}

/** Resolve one canonical root, translating refusals into a stable domain code. */
export async function resolveSafeDirectory(options: SafeDirectoryOptions): Promise<string> {
  return await resolveSafeDirectoryPath({
    configured: options.configured,
    defaultRoot: options.defaultRoot,
    create: options.create,
    readOnly: options.readOnly,
    allowMissing: options.allowMissing,
    deps: options.deps,
    refuse: (reason) => {
      throw new ZoteroError(`The ${options.label} is not usable: ${reason}`, options.errorCode)
    },
  })
}
