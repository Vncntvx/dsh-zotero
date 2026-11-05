/**
 * Cross-platform path resolution for Zotero attachment file locations.
 *
 * Zotero's Local API runs on the host that owns the library, so a Windows-side
 * Zotero reports file URLs using Windows semantics (`file:///C:/…` or UNC
 * `file://server/share/…` or `file://wsl.localhost/…`). When the plugin runs
 * under POSIX (especially WSL or Linux containers), Node's native `fileURLToPath`
 * turns a drive-letter URL into `/C:/…` — a path that exists on no normal Linux
 * filesystem, leading to false ENOENT errors.
 *
 * This module provides multi-candidate path resolution, WSL mount detection
 * (including custom `/etc/wsl.conf` automount roots), UNC host handling,
 * and semantic error discrimination (distinguishing genuinely missing files
 * from unmounted foreign drives).
 * @module dsh-zotero/local/path-resolution
 */

import { access as defaultAccess } from 'node:fs/promises'
import { readFileSync as defaultReadFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { errnoCodeOf, ZOTERO_FILE_MISSING, ZOTERO_FILE_UNREADABLE, ZoteroError } from '../errors.js'
import { isWsl } from '../environment.js'
import { missingAttachmentFileMessage } from './attachment-messages.js'

/** Matches a Windows drive letter at the start of a POSIX-mapped path: `/C:/...` or `/c:/...`. */
export const POSIX_WINDOWS_DRIVE_PATTERN = /^\/([A-Za-z]):(?:\/|$)/

/** Matches a POSIX WSL drive mount: `/mnt/c/...` or `/c/...`. */
export const POSIX_WSL_MOUNT_PATTERN = /^(?:\/mnt)?\/([a-zA-Z])(?:\/|$)/

/** Matches WSL interop UNC host names: `wsl.localhost` or `wsl$`. */
export const WSL_UNC_HOST_PATTERN = /^wsl(?:\.localhost|\$)$/i

/** Model-facing message when a foreign drive is not mounted in the current environment. */
export function unmountedDriveMessage(drive: string, reported: string): string {
  return `Zotero reported a Windows path (${reported}), but drive ${drive.toUpperCase()}: is not mounted or accessible in this environment.`
}

/** Model-facing message when an attachment points to an unmapped network share. */
export function unsupportedUncShareMessage(uncPath: string): string {
  return `The attachment file is on a network share (${uncPath}) that is not accessible in this environment.`
}

/** Model-facing message when an attachment points to a WSL UNC share that cannot be reached. */
export function unsupportedWslUncMessage(reported: string): string {
  return `The attachment file is on a WSL distribution (${reported}) that is not accessible in this environment.`
}

/** Convert a drive letter and POSIX subpath to a native Win32 path. */
export function toWin32Path(drive: string, subpath: string): string {
  return `${drive.toUpperCase()}:${subpath.replace(/\//g, '\\')}`
}

/**
 * Record a mount path for a drive letter in the mounts mapping.
 */
function recordMount(mapping: Map<string, string[]>, drive: string, mountPath: string): void {
  const lower = drive.toLowerCase()
  const existing = mapping.get(lower) ?? []
  if (!existing.includes(mountPath)) {
    existing.push(mountPath)
    mapping.set(lower, existing)
  }
}

/**
 * Parse Linux mount points from `/proc/mounts` or mountinfo text.
 * Discovers where Windows drives are mounted under WSL drvfs/9p.
 * Correctly accounts for Linux kernel octal escaping (`\134` for `\`).
 * Returns a map from lowercase drive letter to list of mount paths (e.g. `'c' -> ['/mnt/c']`).
 */
export function parseWslMounts(mountsContent: string): Map<string, string[]> {
  const mapping = new Map<string, string[]>()
  for (const line of mountsContent.split('\n')) {
    // Fast line filter: only inspect lines related to WSL Windows drive mounts
    if (!line.includes('9p') && !line.includes('drvfs')) continue
    const parts = line.trim().split(/\s+/)
    if (parts.length < 3) continue
    const [spec, mountPath, fstype] = parts
    if (fstype !== '9p' && fstype !== 'drvfs') continue

    // Pattern 1: `C:\ /mnt/c 9p ...` or `C:\134 /mnt/c 9p ...` (Linux kernel \134 escape)
    const specMatch = spec ? /^([A-Za-z]):(?:\\|\\134)?$/.exec(spec) : null
    if (specMatch?.[1]) {
      recordMount(mapping, specMatch[1], mountPath!)
      continue
    }

    // Pattern 2: mount options containing `path=C:\;` or `path=C:\134;`
    const mntOpts = parts[3] ?? ''
    const optsMatch = /path=([A-Za-z]):(?:\\|\\134);/i.exec(mntOpts)
    if (optsMatch?.[1]) {
      recordMount(mapping, optsMatch[1], mountPath!)
    }
  }
  return mapping
}

/** Process-level singleton cache for discovered WSL mounts. */
let processWslMountsCache: Map<string, string[]> | null = null

/** Clear the process-level WSL mounts cache (primarily for tests). */
export function clearWslMountsCache(): void {
  processWslMountsCache = null
}

/**
 * Read active WSL mount points from `/proc/mounts` if available.
 * Memoizes results at the module level when running against the default filesystem.
 */
export function discoverWslMounts(
  deps: { readFileSync?: (path: string, encoding: 'utf-8') => string } = {},
): Map<string, string[]> {
  if (deps.readFileSync === undefined && processWslMountsCache !== null) {
    return processWslMountsCache
  }
  const readFileSync = deps.readFileSync ?? defaultReadFileSync
  try {
    const content = readFileSync('/proc/mounts', 'utf-8')
    const parsed = parseWslMounts(content)
    if (deps.readFileSync === undefined) {
      processWslMountsCache = parsed
    }
    return parsed
  } catch {
    return new Map()
  }
}

/**
 * Discover possible mount root candidates for a given drive letter on POSIX.
 * Returns discovered and explicit roots, plus conventional roots only under WSL.
 */
export function candidateMountRootsForDrive(
  drive: string,
  options: {
    mountPointsMap?: Map<string, string[]>
    mountRoot?: string
    platform?: NodeJS.Platform
    env?: NodeJS.ProcessEnv
  } = {},
): string[] {
  const { platform = process.platform, env = process.env } = options
  const lowerDrive = drive.toLowerCase()
  const candidates = new Set<string>()

  // 1. Explicit map from /proc/mounts if available
  const discovered = options.mountPointsMap?.get(lowerDrive)
  if (discovered) {
    for (const d of discovered) candidates.add(d)
  }

  // 2. Custom or explicit mountRoot if provided
  if (options.mountRoot) {
    candidates.add(`${options.mountRoot.replace(/\/+$/, '')}/${lowerDrive}`)
  }

  // Conventional roots are only meaningful in WSL; native POSIX hosts may use
  // these paths for unrelated mounts.
  if (platform === 'linux' && isWsl(env)) {
    candidates.add(`/mnt/${lowerDrive}`)
    candidates.add(`/${lowerDrive}`)
  }

  return Array.from(candidates)
}

/** Structured representation of a parsed attachment file URL. */
export type ParsedAttachmentLocation =
  | {
      readonly kind: 'windows-drive'
      readonly drive: string
      readonly subpath: string
      readonly reported: string
    }
  | {
      readonly kind: 'wsl-unc'
      readonly distro: string
      readonly subpath: string
      readonly reported: string
    }
  | {
      readonly kind: 'remote-unc'
      readonly uncPath: string
      readonly reported: string
    }
  | {
      readonly kind: 'wsl-mount-on-windows'
      readonly drive: string
      readonly subpath: string
      readonly reported: string
    }
  | {
      readonly kind: 'local-path'
      readonly path: string
      readonly reported: string
    }

/**
 * Safely extract a local filesystem path from a file: URL.
 * Preserves completely decoded characters (`#`, `+`, `&`, spaces).
 */
function safeFileURLToPath(target: URL): string {
  try {
    return fileURLToPath(target)
  } catch {
    return target.pathname.split('/').map(decodeURIComponent).join('/')
  }
}

/**
 * Parse an attachment file URL safely across OS platforms.
 * Handles Windows drive letters, WSL UNC paths, network UNC hosts, and standard local paths.
 */
export function parseAttachmentFileUrl(
  target: URL,
  platform: NodeJS.Platform = process.platform,
): ParsedAttachmentLocation {
  const host = target.host
  const rawPathname = target.pathname

  // 1. Handle UNC Hosts (target.host is not empty and not localhost) or 4-slash URLs (file:////host/share/...)
  const isFourSlashUnc = host === '' && rawPathname.startsWith('//')
  if ((host !== '' && host !== 'localhost') || isFourSlashUnc) {
    const uncHost = isFourSlashUnc ? (rawPathname.slice(2).split('/')[0] ?? '') : host
    const uncRemainingPath = isFourSlashUnc ? rawPathname.slice(2 + uncHost.length) : rawPathname

    if (WSL_UNC_HOST_PATTERN.test(uncHost)) {
      // Shape: file://wsl.localhost/<distro>/path/to/file or file://wsl.localhost/<distro>
      const match = /^\/([^/]+)(?:\/(.*))?$/.exec(uncRemainingPath)
      const distro = match?.[1] ? decodeURIComponent(match[1]) : ''
      const subpath = match?.[2] ? `/${match[2].split('/').map(decodeURIComponent).join('/')}` : '/'
      return {
        kind: 'wsl-unc',
        distro,
        subpath,
        reported: target.href,
      }
    }

    // Remote UNC share: \\host\share\path
    const decodedSegments = uncRemainingPath.split('/').map(decodeURIComponent)
    const uncPath = `\\\\${uncHost}${decodedSegments.join('\\')}`
    return {
      kind: 'remote-unc',
      uncPath,
      reported: target.href,
    }
  }

  // 2. Running on POSIX: check for Windows Drive Letter (`/C:/...`)
  if (platform !== 'win32') {
    const decodedPath = safeFileURLToPath(target)
    const match = POSIX_WINDOWS_DRIVE_PATTERN.exec(decodedPath)
    if (match?.[1]) {
      const drive = match[1].toLowerCase()
      const subpath = decodedPath.slice(3) // removes `/C:`
      return {
        kind: 'windows-drive',
        drive,
        subpath: subpath.startsWith('/') ? subpath : `/${subpath}`,
        reported: decodedPath,
      }
    }
    return { kind: 'local-path', path: decodedPath, reported: decodedPath }
  }

  // 3. Running on Windows: check if a POSIX or WSL mount path was reported
  const decodedPath = safeFileURLToPath(target)
  const wslMountMatch = POSIX_WSL_MOUNT_PATTERN.exec(decodedPath)
  if (wslMountMatch?.[1]) {
    const drive = wslMountMatch[1].toLowerCase()
    const prefixLen = wslMountMatch[0].endsWith('/')
      ? wslMountMatch[0].length - 1
      : wslMountMatch[0].length
    const subpath = decodedPath.slice(prefixLen)
    return {
      kind: 'wsl-mount-on-windows',
      drive,
      subpath: subpath.startsWith('/') ? subpath : `/${subpath}`,
      reported: decodedPath,
    }
  }

  return { kind: 'local-path', path: decodedPath, reported: decodedPath }
}

/**
 * Generate candidate local filesystem paths for a parsed attachment location.
 * The candidates are returned in deterministic priority order:
 * most likely existing paths on the current platform are ordered first.
 */
export function candidateLocalPaths(
  parsed: ParsedAttachmentLocation,
  options: {
    platform?: NodeJS.Platform
    mountPointsMap?: Map<string, string[]>
    mountRoot?: string
    env?: NodeJS.ProcessEnv
  } = {},
): string[] {
  const { platform = process.platform, env = process.env } = options

  switch (parsed.kind) {
    case 'windows-drive': {
      const roots = candidateMountRootsForDrive(parsed.drive, options)
      const list = new Set<string>()
      list.add(parsed.reported)
      for (const root of roots) {
        list.add(`${root}${parsed.subpath}`)
      }
      return Array.from(list)
    }

    case 'wsl-unc': {
      if (platform === 'win32') {
        return [`\\\\wsl.localhost\\${parsed.distro}${parsed.subpath.replace(/\//g, '\\')}`]
      }
      // On POSIX: only candidate local POSIX path if we are running in WSL
      if (isWsl(env)) {
        const currentDistro = env.WSL_DISTRO_NAME
        const list = new Set<string>()
        if (!currentDistro || currentDistro.toLowerCase() === parsed.distro.toLowerCase()) {
          list.add(parsed.subpath)
        }
        list.add(`/mnt/wsl/${parsed.distro}${parsed.subpath}`)
        return Array.from(list)
      }
      // On macOS or native Linux, WSL UNC is not mounted
      return []
    }

    case 'wsl-mount-on-windows':
      return [toWin32Path(parsed.drive, parsed.subpath), parsed.reported]

    case 'local-path':
      return [parsed.path]

    case 'remote-unc':
      return [parsed.uncPath]
  }
}

/** Dependencies for resolving an attachment file on disk. */
export interface PathResolutionDeps {
  readonly access?: (path: string) => Promise<void>
  readonly readFileSync?: (path: string, encoding: 'utf-8') => string
  readonly platform?: NodeJS.Platform
  readonly env?: NodeJS.ProcessEnv
  readonly mountRoot?: string
  readonly signal?: AbortSignal
  readonly missingFileMessage?: (path: string) => string
}

/**
 * Resolve an attachment `file:` URL to an existing, verified path on the local filesystem.
 *
 * If the file is found at any candidate path, returns that path.
 * If all candidates fail:
 * - When a Windows drive was reported and no candidate mount root exists, throws `ZOTERO_FILE_UNREADABLE`
 *   with an explicit unmounted drive diagnosis.
 * - When the mount root exists but the file is missing inside it, throws `ZOTERO_FILE_MISSING`
 *   with the missing file message.
 * - For unmapped remote UNC paths or unreachable WSL UNC paths on non-WSL hosts, throws `ZOTERO_FILE_UNREADABLE`.
 */
export async function resolveExistingAttachmentPath(
  target: URL,
  deps: PathResolutionDeps = {},
): Promise<{ path: string; reported: string }> {
  const {
    access = defaultAccess,
    platform = process.platform,
    env = process.env,
    mountRoot,
    signal,
    missingFileMessage = missingAttachmentFileMessage,
  } = deps

  signal?.throwIfAborted()
  const parsed = parseAttachmentFileUrl(target, platform)

  if (parsed.kind === 'remote-unc' && platform !== 'win32') {
    throw new ZoteroError(unsupportedUncShareMessage(parsed.uncPath), ZOTERO_FILE_UNREADABLE)
  }

  if (parsed.kind === 'wsl-unc' && platform !== 'win32' && !isWsl(env)) {
    throw new ZoteroError(unsupportedWslUncMessage(parsed.reported), ZOTERO_FILE_UNREADABLE)
  }

  let mountPointsMap: Map<string, string[]> | undefined
  // Only probe WSL mounts on Linux hosts running under WSL
  if (parsed.kind === 'windows-drive' && platform === 'linux' && isWsl(env)) {
    mountPointsMap = discoverWslMounts(deps)
  }

  const candidates = candidateLocalPaths(parsed, {
    platform,
    mountPointsMap,
    mountRoot,
    env,
  })

  for (const candidate of candidates) {
    signal?.throwIfAborted()
    try {
      await access(candidate)
      return { path: candidate, reported: parsed.reported }
    } catch (error) {
      if (errnoCodeOf(error) !== 'ENOENT') {
        throw new ZoteroError(
          `The attachment file cannot be accessed: ${candidate}`,
          ZOTERO_FILE_UNREADABLE,
          {
            cause: error,
          },
        )
      }
    }
  }

  // All candidates failed with ENOENT. Diagnose why:
  if (parsed.kind === 'windows-drive' && platform !== 'win32') {
    // If on macOS or non-WSL Linux, Windows drive is inherently not mounted
    if (platform === 'darwin' || !isWsl(env)) {
      throw new ZoteroError(
        unmountedDriveMessage(parsed.drive, parsed.reported),
        ZOTERO_FILE_UNREADABLE,
      )
    }

    // On WSL: check if the drive was discovered in mountPointsMap
    if (mountPointsMap?.has(parsed.drive.toLowerCase())) {
      throw new ZoteroError(missingFileMessage(parsed.reported), ZOTERO_FILE_MISSING)
    }

    const roots = candidateMountRootsForDrive(parsed.drive, {
      mountPointsMap,
      mountRoot,
      platform,
      env,
    })
    let hasAnyMountRoot = false
    for (const root of roots) {
      try {
        await access(root)
        hasAnyMountRoot = true
        break
      } catch {
        // Mount root does not exist
      }
    }

    if (!hasAnyMountRoot) {
      throw new ZoteroError(
        unmountedDriveMessage(parsed.drive, parsed.reported),
        ZOTERO_FILE_UNREADABLE,
      )
    }
  }

  throw new ZoteroError(missingFileMessage(parsed.reported), ZOTERO_FILE_MISSING)
}
