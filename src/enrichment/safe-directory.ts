/**
 * Resolve and validate a directory the plugin may write into.
 *
 * The rule set is the one `output-dir.ts` established for parsed artifacts,
 * generalized so the semantic-model directory gets the same guarantees: a
 * candidate is treated as untrusted input — absolute, resolvable, a real
 * directory, writable, not a sensitive system or credential path, and not a
 * symlink that escapes into one — with every comparison made in canonical
 * space on both sides (macOS `/etc` → `/private/etc` is caught).
 *
 * Two policies differ between callers and are explicit here:
 * - `create`: whether a missing directory may be created. The artifact store
 *   creates only its default root; the model downloader may create either.
 *   Creation validates the nearest existing ancestor first, then re-validates
 *   the created path, so a `mkdir` can never be the step that touches a
 *   sensitive location.
 * - the error code and noun, so each caller reports its own domain.
 * @module dsh-zotero/enrichment/safe-directory
 */

import { access, constants, mkdir, realpath, stat } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { isAbsolute, resolve, sep } from 'node:path'
import { expandHomePath } from '@deepseek-ai/dsh-home-paths'
import { ZoteroError, type ZoteroErrorCode } from '../errors.js'

/** Filesystem seams, injectable so unit tests never touch the real disk. */
export interface SafeDirectoryDeps {
  readonly realpath: (path: string) => Promise<string>
  readonly stat: (path: string) => Promise<{ isDirectory(): boolean }>
  readonly access: (path: string, mode: number) => Promise<void>
  readonly mkdir: (path: string) => Promise<void>
  readonly home?: () => string
  readonly temp?: () => string
}

export const hostSafeDirectoryDeps: SafeDirectoryDeps = {
  realpath,
  stat,
  access,
  mkdir: async (path) => {
    await mkdir(path, { recursive: true })
  },
}

/** Credential-bearing user directories nothing may be written into. */
const SENSITIVE_USER_DIRS = ['.ssh', '.gnupg'] as const

/** System roots a plugin must never write into. */
const SYSTEM_ROOTS = [
  '/',
  '/etc',
  '/usr',
  '/bin',
  '/sbin',
  '/var',
  '/System',
  '/Library',
  '/Windows',
  '/Program Files',
] as const

async function canonicalOf(path: string, deps: SafeDirectoryDeps): Promise<string> {
  try {
    return await deps.realpath(path)
  } catch {
    return resolve(path)
  }
}

/** Every canonical directory a candidate may not equal or descend into. */
async function sensitiveRoots(deps: SafeDirectoryDeps): Promise<{
  readonly exact: readonly string[]
  readonly prefixes: readonly string[]
  readonly temp: string
}> {
  const home = await canonicalOf((deps.home ?? homedir)(), deps)
  const temp = await canonicalOf((deps.temp ?? tmpdir)(), deps)
  const system = await Promise.all(
    SYSTEM_ROOTS.filter((root) => root !== '/').map(async (root) => await canonicalOf(root, deps)),
  )
  const user = await Promise.all(
    SENSITIVE_USER_DIRS.map(async (name) => await canonicalOf(resolve(home, name), deps)),
  )
  return {
    // The home directory itself and the filesystem root are refused exactly;
    // every other home subdirectory (including the default ~/.dsh) is allowed.
    exact: [sep, home],
    prefixes: [...new Set([...system, ...user])],
    // The OS temp root is user-writable scratch space; `mkdtemp` output and
    // tests legitimately live there even when it canonicalizes under /var.
    temp,
  }
}

function isSensitivePath(
  candidate: string,
  roots: {
    readonly exact: readonly string[]
    readonly prefixes: readonly string[]
    readonly temp: string
  },
): boolean {
  if (candidate === roots.temp || candidate.startsWith(roots.temp + sep)) return false
  if (roots.exact.includes(candidate)) return true
  return roots.prefixes.some((root) => candidate === root || candidate.startsWith(root + sep))
}

export interface SafeDirectoryOptions {
  /** The configured value; empty means the default root. */
  readonly configured: string
  /** The default root, used when `configured` is empty. */
  readonly defaultRoot: string
  /** Whether a missing configured directory may be created. */
  readonly create: boolean
  /** The stable error code failures carry. */
  readonly errorCode: ZoteroErrorCode
  /** The domain noun in error messages, e.g. `output directory`. */
  readonly label: string
  readonly deps?: SafeDirectoryDeps
}

/**
 * Resolve one writable directory under the rules above.
 * @returns the absolute, validated directory path.
 * @throws {ZoteroError} `options.errorCode` for any unsafe value.
 */
export async function resolveSafeDirectory(options: SafeDirectoryOptions): Promise<string> {
  const deps = options.deps ?? hostSafeDirectoryDeps
  const refuse = (reason: string): never => {
    throw new ZoteroError(`The ${options.label} is not usable: ${reason}`, options.errorCode)
  }

  const trimmed = options.configured.trim()
  if (trimmed === '') {
    try {
      await deps.mkdir(options.defaultRoot)
    } catch (error) {
      refuse(`could not create the default directory (${(error as Error).message})`)
    }
    // The default root gets the same checks as a configured one: it lives
    // under the home directory today, but DSH_HOME can point anywhere.
    const roots = await sensitiveRoots(deps)
    const canonical = await canonicalOf(options.defaultRoot, deps)
    if (isSensitivePath(canonical, roots)) {
      refuse('the default path is a sensitive system or credential directory')
    }
    try {
      const info = await deps.stat(canonical)
      if (!info.isDirectory()) refuse('the default path is not a directory')
      await deps.access(canonical, constants.W_OK)
    } catch (error) {
      refuse(`the default path is not a writable directory (${(error as Error).message})`)
    }
    return options.defaultRoot
  }

  const expanded = expandHomePath(trimmed)
  const absolute = isAbsolute(expanded) ? resolve(expanded) : refuse('the path is not absolute')

  const roots = await sensitiveRoots(deps)
  const validate = async (canonical: string): Promise<string> => {
    if (!isAbsolute(canonical)) refuse('the resolved path is not absolute')
    if (isSensitivePath(canonical, roots)) {
      refuse('the path is a sensitive system or credential directory')
    }
    try {
      const info = await deps.stat(canonical)
      if (!info.isDirectory()) refuse('the path is not a directory')
    } catch (error) {
      refuse(`the directory could not be inspected (${(error as Error).message})`)
    }
    try {
      await deps.access(canonical, constants.W_OK)
    } catch (error) {
      refuse(`the directory is not writable (${(error as Error).message})`)
    }
    return canonical
  }

  try {
    const canonical = await deps.realpath(absolute)
    return await validate(canonical)
  } catch (error) {
    // Only the "does not exist" case may continue, into creation; every other
    // realpath failure (loop, permission) is its own refusal.
    if (options.create === false) {
      refuse(`the directory does not exist or is not resolvable (${(error as Error).message})`)
    }
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      refuse(`the path cannot be resolved (${(error as Error).message})`)
    }
  }

  // The candidate does not exist. Validate its nearest existing ancestor in
  // canonical space, then create the leaf and re-validate the result, so the
  // creation step itself can never land in a sensitive location.
  let ancestor = absolute
  for (;;) {
    const parent = resolve(ancestor, '..')
    if (parent === ancestor) refuse('the path has no existing parent directory')
    ancestor = parent
    try {
      await deps.stat(ancestor)
      break
    } catch {
      continue
    }
  }
  const ancestorCanonical = await deps.realpath(ancestor)
  if (isSensitivePath(ancestorCanonical, roots)) {
    refuse('the path resolves into a sensitive system or credential directory')
  }
  try {
    await deps.mkdir(absolute)
  } catch (error) {
    refuse(`the directory could not be created (${(error as Error).message})`)
  }
  return await validate(await deps.realpath(absolute))
}
