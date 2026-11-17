/** Publication identity and registry failures, without network access. */
import { createHash } from 'node:crypto'
import { expect, it, vi } from 'vitest'
import {
  assertRegistryArtifact,
  registryTarball,
  registryVersion,
} from '../../../scripts/npm-registry.mjs'

const manifest = { name: 'dsh-zotero', version: '1.0.0' }
const bytes = Buffer.from('the verified tarball')
const metadata = {
  ...manifest,
  dist: {
    integrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}`,
    tarball: 'https://registry.npmjs.org/dsh-zotero/-/dsh-zotero-1.0.0.tgz',
  },
}

it('accepts an existing version only when its identity and integrity match', () => {
  expect(() => assertRegistryArtifact(metadata, manifest, bytes)).not.toThrow()
  expect(() => assertRegistryArtifact(metadata, manifest, Buffer.from('other bytes'))).toThrow(
    'differs',
  )
  expect(() => assertRegistryArtifact({ ...metadata, version: '2.0.0' }, manifest, bytes)).toThrow(
    'differs',
  )
  expect(() => assertRegistryArtifact({ ...metadata, name: 'other' }, manifest, bytes)).toThrow(
    'differs',
  )
})

it('allows publication only on registry HTTP 404', async () => {
  const fetchImpl = vi.fn(async () => new Response(null, { status: 404 }))
  await expect(registryVersion(manifest.name, manifest.version, { fetchImpl })).resolves.toBe(
    undefined,
  )
  expect(fetchImpl).toHaveBeenCalledOnce()
})

it.each([401, 403, 429, 500])('rejects publication on registry HTTP %s', async (status) => {
  const fetchImpl = vi.fn(async () => new Response(null, { status }))
  await expect(registryVersion(manifest.name, manifest.version, { fetchImpl })).rejects.toThrow(
    `HTTP ${status}`,
  )
  expect(fetchImpl).toHaveBeenCalledOnce()
})

it('preserves network lookup failures', async () => {
  const fetchImpl = vi.fn(async () => {
    throw new Error('connection refused')
  })
  await expect(registryVersion(manifest.name, manifest.version, { fetchImpl })).rejects.toThrow(
    'connection refused',
  )
})

it('waits for publication visibility before checking the registry artifact', async () => {
  const fetchImpl = vi
    .fn(async () => Response.json(metadata))
    .mockResolvedValueOnce(new Response(null, { status: 404 }))
  const delay = vi.fn(async () => {})
  await expect(
    registryVersion(manifest.name, manifest.version, {
      fetchImpl,
      waitForPublication: true,
      delay,
    }),
  ).resolves.toEqual(metadata)
  expect(fetchImpl).toHaveBeenCalledTimes(2)
  expect(delay).toHaveBeenCalledOnce()
})

it('bounds the wait for a published version', async () => {
  const fetchImpl = vi.fn(async () => new Response(null, { status: 404 }))
  const delay = vi.fn(async () => {})
  await expect(
    registryVersion(manifest.name, manifest.version, {
      fetchImpl,
      waitForPublication: true,
      delay,
    }),
  ).rejects.toThrow('not visible')
  expect(fetchImpl).toHaveBeenCalledTimes(30)
})

it('verifies downloaded bytes against the tarball that passed installation smoke', async () => {
  const fetchImpl = vi.fn(async () => new Response(bytes))
  await expect(registryTarball(metadata, manifest, bytes, fetchImpl)).resolves.toEqual(bytes)
  expect(fetchImpl).toHaveBeenCalledWith(new URL(metadata.dist.tarball), {
    redirect: 'error',
    signal: expect.any(AbortSignal),
  })
  fetchImpl.mockResolvedValueOnce(new Response('different bytes'))
  await expect(registryTarball(metadata, manifest, bytes, fetchImpl)).rejects.toThrow('differs')
})

it('retries when the registry tarball URL is temporarily unavailable', async () => {
  const fetchImpl = vi
    .fn(async () => new Response(bytes))
    .mockResolvedValueOnce(new Response(null, { status: 404 }))
    .mockResolvedValueOnce(new Response(null, { status: 503 }))
  const delay = vi.fn(async () => {})
  await expect(
    registryTarball(metadata, manifest, bytes, { fetchImpl, delay, maxAttempts: 5 }),
  ).resolves.toEqual(bytes)
  expect(fetchImpl).toHaveBeenCalledTimes(3)
  expect(delay).toHaveBeenCalledTimes(2)
})

it('refuses a substituted tarball host before downloading', async () => {
  const fetchImpl = vi.fn()
  await expect(
    registryTarball(
      { ...metadata, dist: { ...metadata.dist, tarball: 'https://example.com/package.tgz' } },
      manifest,
      bytes,
      fetchImpl,
    ),
  ).rejects.toThrow('leaves registry.npmjs.org')
  expect(fetchImpl).not.toHaveBeenCalled()
})
