/** Bind the public registry package to the tarball that passed installation smoke. */
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { setTimeout as pause } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { verifyReleaseArtifact } from './release-artifact.mjs'

const registry = 'https://registry.npmjs.org'

function tarballUrl(metadata) {
  const url = new URL(metadata.dist.tarball)
  if (url.origin !== registry || url.username || url.password)
    throw new Error('Tarball URL leaves registry.npmjs.org or carries credentials')
  return url
}

async function requestBody(url, options) {
  const { fetchImpl, delay, maxAttempts, timeout, read, label, missing } = options
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
      if (status === 404 && missing === 'return') return undefined
      failure = new Error(
        status === 404 && missing === 'publication'
          ? 'Published version is not visible on registry.npmjs.org'
          : `${label}: HTTP ${status}`,
      )
      if (status !== 404 && status !== 408 && status !== 429 && (status < 500 || status > 599))
        throw failure
    }
    if (attempt === maxAttempts) throw failure
    await delay(2_000)
  }
}

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

/** Returns the registry metadata for a package version, or undefined on HTTP 404. */
export async function registryVersion(
  name,
  version,
  { fetchImpl = fetch, waitForPublication = false, delay = pause, maxAttempts = 30 } = {},
) {
  const url = `${registry}/${encodeURIComponent(name)}/${encodeURIComponent(version)}`
  const text = await requestBody(url, {
    fetchImpl,
    delay,
    maxAttempts,
    timeout: 20_000,
    read: (response) => response.text(),
    label: 'Registry lookup failed',
    missing: waitForPublication ? 'publication' : 'return',
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

/** Downloads the package tarball from the registry and verifies its integrity. */
export async function registryTarball(
  metadata,
  manifest,
  expectedBytes,
  { fetchImpl = fetch, delay = pause, maxAttempts = 15 } = {},
) {
  assertRegistryArtifact(metadata, manifest, expectedBytes)
  const buffer = await requestBody(tarballUrl(metadata), {
    fetchImpl,
    delay,
    maxAttempts,
    timeout: 60_000,
    read: (response) => response.arrayBuffer(),
    label: 'Registry tarball download failed',
  })
  const bytes = Buffer.from(buffer)
  assertRegistryArtifact(metadata, manifest, bytes)
  return bytes
}

async function main() {
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
  const metadata = await registryVersion(manifest.name, manifest.version, {
    waitForPublication: verify,
  })
  if (metadata !== undefined) assertRegistryArtifact(metadata, manifest, bytes)
  if (check) console.log(`PUBLISH_NEEDED=${metadata === undefined}`)
  else {
    const downloaded = await registryTarball(metadata, manifest, bytes)
    writeFileSync(join(out, 'registry.tgz'), downloaded)
    console.log(`Registry tarball verified: ${manifest.name}@${manifest.version}`)
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  await main().catch((error) => {
    console.error(`npm-registry: ${error.message}`)
    process.exitCode = 1
  })
