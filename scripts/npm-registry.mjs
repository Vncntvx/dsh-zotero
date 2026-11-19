/** Bind the public registry package to the tarball that passed installation smoke. */
import { createHash } from 'node:crypto'
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { setTimeout as pause } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { verifyReleaseArtifact } from './release-artifact.mjs'

const registry = 'https://registry.npmjs.org'

/**
 * The registry metadata face for one published package version.
 * @typedef {{
 *   name: string,
 *   version: string,
 *   dist: { tarball: string, integrity?: string },
 * }} RegistryMetadata
 */

/**
 * Resolve the tarball URL of one registry metadata, refusing any URL that
 * leaves the registry host or carries credentials.
 * @param metadata {RegistryMetadata} the registry metadata for one version.
 * @returns {URL} the validated tarball URL.
 */
function tarballUrl(metadata) {
  const url = new URL(metadata.dist.tarball)
  if (url.origin !== registry || url.username || url.password)
    throw new Error('Tarball URL leaves registry.npmjs.org or carries credentials')
  return url
}

/**
 * Fetch a registry URL with bounded retries: a caller-chosen 404 answer,
 * retryable transport and server failures, and everything else fatal.
 * @template T
 * @param url {string | URL} the absolute URL to fetch.
 * @param options {{
 *   fetchImpl: typeof fetch,
 *   delay: (ms: number) => Promise<void>,
 *   maxAttempts: number,
 *   timeout: number,
 *   delayMs?: number,
 *   read: (response: Response) => Promise<T>,
 *   label: string,
 *   missing?: 'return' | 'retry',
 * }} the retry and decoding configuration.
 * @returns {Promise<T | undefined>} the decoded body, or undefined on a 404 with `missing: 'return'`.
 */
async function requestBody(url, options) {
  const { fetchImpl, delay, maxAttempts, timeout, delayMs = 2_000, read, label, missing } = options
  if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1)
    throw new Error('Registry maxAttempts must be a positive integer')
  for (let attempt = 1; ; attempt += 1) {
    let response
    let failure
    try {
      response = await fetchImpl(url, { redirect: 'manual', signal: AbortSignal.timeout(timeout) })
      if (response.ok) return await read(response)
    } catch (error) {
      failure = error
    }
    await response?.body?.cancel().catch(() => {})
    if (response && !response.ok) {
      const { status } = response
      if (
        status === 404 &&
        (missing === 'return' || (missing === 'retry' && attempt === maxAttempts))
      )
        return undefined
      failure = new Error(`${label}: HTTP ${status}`)
      if (status !== 404 && status !== 408 && status !== 429 && (status < 500 || status > 599))
        throw failure
    }
    if (attempt === maxAttempts) throw failure
    await delay(delayMs)
  }
}

/**
 * Bind the registry metadata to the verified artifact bytes: the same name,
 * version, and sha512 integrity.
 * @param metadata {RegistryMetadata} the registry metadata for one version.
 * @param manifest {{ name: string, version: string }} the verified staged manifest.
 * @param bytes {Uint8Array} the verified artifact bytes.
 * @returns {void}
 */
export function assertRegistryArtifact(metadata, manifest, bytes) {
  const integrity = `sha512-${createHash('sha512').update(bytes).digest('base64')}`
  if (
    metadata.name !== manifest.name ||
    metadata.version !== manifest.version ||
    !metadata.dist?.integrity?.split(/\s+/).includes(integrity)
  )
    throw new Error(
      `Registry package differs from the verified artifact; use a new version (artifact ${integrity}, registry ${metadata.dist?.integrity ?? 'missing'})`,
    )
}

/**
 * Returns the registry metadata for a package version, or undefined on HTTP 404.
 * @param name {string} the package name.
 * @param version {string} the exact version.
 * @param options {{
 *   fetchImpl?: typeof fetch,
 *   delay?: (ms: number) => Promise<void>,
 *   maxAttempts?: number,
 *   delayMs?: number,
 *   waitForPublication?: boolean,
 * }} the retry configuration.
 * @returns {Promise<RegistryMetadata | undefined>} the validated metadata.
 */
export async function registryVersion(
  name,
  version,
  { fetchImpl = fetch, delay = pause, maxAttempts = 30, delayMs, waitForPublication = false } = {},
) {
  const url = `${registry}/${encodeURIComponent(name)}/${encodeURIComponent(version)}`
  const text = await requestBody(url, {
    fetchImpl,
    delay,
    maxAttempts,
    delayMs,
    timeout: 20_000,
    read: (response) => response.text(),
    label: 'Registry lookup failed',
    missing: waitForPublication ? 'retry' : 'return',
  })
  if (text === undefined) return undefined
  const metadata = JSON.parse(text)
  if (
    metadata?.name !== name ||
    metadata?.version !== version ||
    typeof metadata.dist?.integrity !== 'string' ||
    !metadata.dist.integrity ||
    typeof metadata.dist.tarball !== 'string'
  )
    throw new Error('Invalid registry metadata for the requested package version')
  tarballUrl(metadata)
  return metadata
}

/**
 * Downloads the package tarball from the registry and verifies its integrity.
 * @param metadata {RegistryMetadata} the registry metadata for one version.
 * @param manifest {{ name: string, version: string }} the verified staged manifest.
 * @param expectedBytes {Uint8Array} the verified artifact bytes the download must match.
 * @param options {{
 *   fetchImpl?: typeof fetch,
 *   delay?: (ms: number) => Promise<void>,
 *   maxAttempts?: number,
 *   delayMs?: number,
 * }} the retry configuration.
 * @returns {Promise<Buffer>} the verified tarball bytes.
 */
export async function registryTarball(
  metadata,
  manifest,
  expectedBytes,
  { fetchImpl = fetch, delay = pause, maxAttempts = 15, delayMs } = {},
) {
  assertRegistryArtifact(metadata, manifest, expectedBytes)
  const buffer = await requestBody(tarballUrl(metadata), {
    fetchImpl,
    delay,
    maxAttempts,
    delayMs,
    timeout: 60_000,
    read: (response) => response.arrayBuffer(),
    label: 'Registry tarball download failed',
  })
  if (buffer === undefined) throw new Error('Registry tarball download returned no body')
  const bytes = Buffer.from(buffer)
  assertRegistryArtifact(metadata, manifest, bytes)
  return bytes
}

async function main() {
  /** @param flag {string} @returns {string | undefined} the flag's value, when present. */
  const value = (flag) => process.argv[process.argv.indexOf(flag) + 1]
  const out = process.argv.includes('--out') && value('--out')
  const source = process.argv.includes('--source-sha') && value('--source-sha')
  const check = process.argv.includes('--check')
  const verify = process.argv.includes('--verify')
  if (!out || !source || check === verify)
    throw new Error('Expected --check or --verify, --out <artifact directory>, --source-sha <SHA>')
  const artifact = verifyReleaseArtifact(resolve(out), source)
  const manifest = JSON.parse(readFileSync(join(artifact.stage, 'package.json'), 'utf8'))
  const bytes = readFileSync(artifact.tarball)
  const metadata = await registryVersion(
    manifest.name,
    manifest.version,
    verify ? { maxAttempts: 12, delayMs: 10_000, waitForPublication: true } : { maxAttempts: 3 },
  )
  if (check) {
    if (metadata !== undefined) assertRegistryArtifact(metadata, manifest, bytes)
    console.log(`PUBLISH_NEEDED=${metadata === undefined}`)
  } else {
    if (metadata === undefined) {
      const message = `${manifest.name}@${manifest.version} is not public yet. Once npm shows Published, re-run the Verify npm Release workflow.`
      if (process.env.GITHUB_STEP_SUMMARY)
        appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${message}\n`)
      throw new Error(message)
    }
    const downloaded = await registryTarball(metadata, manifest, bytes, {
      maxAttempts: 3,
      delayMs: 5_000,
    })
    writeFileSync(join(out, 'registry.tgz'), downloaded)
    console.log(`Registry tarball verified: ${manifest.name}@${manifest.version}`)
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  await main().catch((error) => {
    console.error(`npm-registry: ${error.message}`)
    process.exitCode = 1
  })
