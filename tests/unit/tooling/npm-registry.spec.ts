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

it.each([401, 403, 302])('refuses HTTP %s without retry and cancels the body', async (status) => {
  const cancel = vi.fn()
  const fetchImpl = vi.fn(async () => new Response(new ReadableStream({ cancel }), { status }))
  await expect(registryVersion(manifest.name, manifest.version, { fetchImpl })).rejects.toThrow(
    `HTTP ${status}`,
  )
  expect(fetchImpl).toHaveBeenCalledOnce()
  expect(cancel).toHaveBeenCalledOnce()
})

it('preserves network lookup failures', async () => {
  const fetchImpl = vi.fn(async () => {
    throw new Error('connection refused')
  })
  const delay = vi.fn(async () => {})
  await expect(
    registryVersion(manifest.name, manifest.version, { fetchImpl, delay }),
  ).rejects.toThrow('connection refused')
  expect(fetchImpl).toHaveBeenCalledTimes(30)
  expect(delay).toHaveBeenCalledTimes(29)
})

it('recovers metadata from transient HTTP, network and interrupted body reads', async () => {
  const interrupted = new Response(
    new ReadableStream({ start: (stream) => stream.error(new Error('truncated')) }),
  )
  const fetchImpl = vi
    .fn(async () => Response.json(metadata))
    .mockResolvedValueOnce(new Response(null, { status: 503 }))
    .mockResolvedValueOnce(new Response(null, { status: 429 }))
    .mockResolvedValueOnce(new Response(null, { status: 408 }))
    .mockRejectedValueOnce(new Error('reset'))
    .mockResolvedValueOnce(interrupted)
  const delay = vi.fn(async () => {})
  await expect(
    registryVersion(manifest.name, manifest.version, { fetchImpl, delay }),
  ).resolves.toEqual(metadata)
  expect(delay.mock.calls).toEqual(Array.from({ length: 5 }, () => [2000]))
})

it.each([
  '{',
  '{}',
  JSON.stringify({
    ...metadata,
    dist: { ...metadata.dist, tarball: 'https://example.com/tarball' },
  }),
])('does not retry invalid metadata: %s', async (body) => {
  const fetchImpl = vi.fn(async () => new Response(body))
  await expect(registryVersion(manifest.name, manifest.version, { fetchImpl })).rejects.toThrow()
  expect(fetchImpl).toHaveBeenCalledOnce()
})

it('verifies downloaded bytes against the tarball that passed installation smoke', async () => {
  const fetchImpl = vi.fn(async () => new Response(bytes))
  await expect(registryTarball(metadata, manifest, bytes, { fetchImpl })).resolves.toEqual(bytes)
  expect(fetchImpl).toHaveBeenCalledWith(new URL(metadata.dist.tarball), {
    redirect: 'manual',
    signal: expect.any(AbortSignal),
  })
  fetchImpl.mockResolvedValueOnce(new Response('different bytes'))
  await expect(registryTarball(metadata, manifest, bytes, { fetchImpl })).rejects.toThrow('differs')
  expect(fetchImpl).toHaveBeenCalledTimes(2)
})

it('retries when the registry tarball URL is temporarily unavailable', async () => {
  const fetchImpl = vi
    .fn(async () => new Response(bytes))
    .mockResolvedValueOnce(new Response(null, { status: 404 }))
    .mockResolvedValueOnce(new Response(null, { status: 599 }))
    .mockRejectedValueOnce(new Error('socket closed'))
    .mockResolvedValueOnce(
      new Response(new ReadableStream({ start: (stream) => stream.error(new Error('truncated')) })),
    )
  const delay = vi.fn(async () => {})
  await expect(
    registryTarball(metadata, manifest, bytes, { fetchImpl, delay, maxAttempts: 5 }),
  ).resolves.toEqual(bytes)
  expect(fetchImpl).toHaveBeenCalledTimes(5)
  expect(delay).toHaveBeenCalledTimes(4)
})

it('bounds tarball retries and short-circuits authorization failures', async () => {
  const delay = vi.fn(async () => {})
  const fetchImpl = vi.fn(async () => new Response(null, { status: 503 }))
  await expect(registryTarball(metadata, manifest, bytes, { fetchImpl, delay })).rejects.toThrow(
    'HTTP 503',
  )
  expect(fetchImpl).toHaveBeenCalledTimes(15)
  fetchImpl.mockResolvedValueOnce(new Response(null, { status: 403 }))
  await expect(registryTarball(metadata, manifest, bytes, { fetchImpl, delay })).rejects.toThrow(
    'HTTP 403',
  )
  expect(fetchImpl).toHaveBeenCalledTimes(16)
  expect(delay).toHaveBeenCalledTimes(14)
})

it('refuses a substituted tarball host before downloading', async () => {
  const fetchImpl = vi.fn()
  await expect(
    registryTarball(
      { ...metadata, dist: { ...metadata.dist, tarball: 'https://example.com/package.tgz' } },
      manifest,
      bytes,
      { fetchImpl },
    ),
  ).rejects.toThrow('leaves registry.npmjs.org')
  expect(fetchImpl).not.toHaveBeenCalled()
})
