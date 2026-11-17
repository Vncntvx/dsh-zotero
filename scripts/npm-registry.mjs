/** Bind the public registry package to the tarball that passed installation smoke. */
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { setTimeout as pause } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { verifyReleaseArtifact } from './release-artifact.mjs'

const registry = 'https://registry.npmjs.org'

export function assertRegistryArtifact(metadata, manifest, bytes) {
  const integrity = `sha512-${createHash('sha512').update(bytes).digest('base64')}`
  if (
    metadata.name !== manifest.name ||
    metadata.version !== manifest.version ||
    !metadata.dist?.integrity?.split(/\s+/).includes(integrity)
  )
    throw new Error('Registry package differs from the verified artifact; use a new version')
}

/** Returns the registry metadata for a package version, or undefined on HTTP 404. */
export async function registryVersion(
  name,
  version,
  { fetchImpl = fetch, waitForPublication = false, delay = pause } = {},
) {
  const url = `${registry}/${encodeURIComponent(name)}/${encodeURIComponent(version)}`
  for (let attempt = 0; ; attempt += 1) {
    const response = await fetchImpl(url, {
      redirect: 'error',
      signal: AbortSignal.timeout(20_000),
    })
    if (response.status === 404) {
      await response.body?.cancel()
      if (!waitForPublication) return undefined
      if (attempt === 5) throw new Error('Published version is not visible on registry.npmjs.org')
      await delay(2_000)
      continue
    }
    if (!response.ok) throw new Error(`Registry lookup failed: HTTP ${response.status}`)
    return response.json()
  }
}

/** Downloads the package tarball from the registry and verifies its integrity. */
export async function registryTarball(metadata, manifest, expectedBytes, fetchImpl = fetch) {
  assertRegistryArtifact(metadata, manifest, expectedBytes)
  const url = new URL(metadata.dist.tarball)
  if (url.origin !== registry) throw new Error('Tarball URL leaves registry.npmjs.org')
  const response = await fetchImpl(url, {
    redirect: 'error',
    signal: AbortSignal.timeout(60_000),
  })
  if (!response.ok) throw new Error(`Registry tarball download failed: HTTP ${response.status}`)
  const bytes = Buffer.from(await response.arrayBuffer())
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
