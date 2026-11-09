/**
 * Resolve and validate the directory parsed artifacts are written to.
 *
 * The default is the harness user-data root (`dshHomePath('zotero-parsed')`),
 * resolved at runtime so a home relocation does not strand stored state. A
 * configured directory is treated as untrusted input: it must be absolute,
 * resolvable, a real directory, writable, not a sensitive system path, and not
 * a symlink that escapes to one. The comparison is made in canonical space on
 * both sides: on macOS `/etc` and `/var` are symlinks into `/private`, so
 * checking a realpath'd candidate against lexical roots would miss them.
 * The empty string means "use the default" and is what the settings field's
 * restore-default action writes.
 * @module dsh-zotero/parsing/output-dir
 */

import { access, constants, mkdir, realpath, stat } from 'node:fs/promises'
import { isAbsolute, resolve, sep } from 'node:path'
import { homedir, tmpdir } from 'node:os'
import { dshHomePath, expandHomePath } from '@deepseek-ai/dsh-home-paths'
import { ZOTERO_PARSING_OUTPUT_INVALID, ZoteroError } from '../errors.js'

/** Host seams, injectable so unit tests never touch the real filesystem. */
export interface OutputDirDeps {
  readonly realpath: (path: string) => Promise<string>
  readonly stat: (path: string) => Promise<{ isDirectory: () => boolean }>
  readonly access: (path: string, mode: number) => Promise<void>
  /** Create the directory and any missing parents. */
  readonly mkdir: (path: string) => Promise<void>
}

const hostDeps: OutputDirDeps = {
  realpath,
  stat,
  access,
  mkdir: async (path) => {
    await mkdir(path, { recursive: true })
  },
}

/** Credential-bearing user directories no artifact may be written into. */
const SENSITIVE_USER_DIRS = ['.ssh', '.gnupg'] as const

/** System roots a plugin must never write parsed artifacts into. */
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

async function canonicalOf(path: string, deps: OutputDirDeps): Promise<string> {
  try {
    return await deps.realpath(path)
  } catch {
    return resolve(path)
  }
}

/** Every canonical directory a candidate may not equal or descend into. */
async function sensitiveRoots(deps: OutputDirDeps): Promise<{
  readonly exact: readonly string[]
  readonly prefixes: readonly string[]
  readonly temp: string
}> {
  const home = await canonicalOf(homedir(), deps)
  const temp = await canonicalOf(tmpdir(), deps)
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

function refuse(reason: string): never {
  throw new ZoteroError(
    `Parsing output directory is not usable: ${reason}`,
    ZOTERO_PARSING_OUTPUT_INVALID,
  )
}

/**
 * Resolve the output directory, creating it when needed.
 * @param configured - the configured path; empty means the default.
 * @param deps - filesystem seams (defaults to the real host).
 * @returns the absolute, validated directory path.
 * @throws {ZoteroError} `ZOTERO_PARSING_OUTPUT_INVALID` for any unsafe value.
 */
export async function resolveOutputDir(
  configured: string,
  deps: OutputDirDeps = hostDeps,
): Promise<string> {
  const trimmed = configured.trim()
  if (trimmed === '') {
    const root = dshHomePath('zotero-parsed')
    try {
      await deps.mkdir(root)
    } catch (error) {
      refuse(`could not create the default directory (${(error as Error).message})`)
    }
    return root
  }

  const expanded = expandHomePath(trimmed)
  const absolute = isAbsolute(expanded) ? resolve(expanded) : refuse('the path is not absolute')

  let canonical: string
  try {
    canonical = await deps.realpath(absolute)
  } catch (error) {
    refuse(`the directory does not exist or is not resolvable (${(error as Error).message})`)
  }
  if (!isAbsolute(canonical)) refuse('the resolved path is not absolute')
  if (isSensitivePath(canonical, await sensitiveRoots(deps))) {
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
