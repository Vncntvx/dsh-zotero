/**
 * The bundle verifier: manifest↔catalog agreement, pinned sizes, pinned
 * digests, and the fail-closed error class — all against injected filesystem
 * seams, so no test needs a real model bundle.
 * @module tests/unit/semantic-bundle
 */

import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { manifestOf, semanticModelOf } from '../../src/enrichment-model-catalog.ts'
import { openSemanticEmbedder, verifySemanticBundle } from '../../src/enrichment/semantic/bundle.ts'
import { ZOTERO_ENRICHMENT_SEMANTIC_UNAVAILABLE } from '../../src/errors.ts'

const spec = semanticModelOf('lightweight')

/**
 * Files at their catalog-pinned sizes; the digest seam answers with the
 * catalog's own pinned digest, so the fixture does not need the real upstream
 * bytes — the verifier's checks stay exactly the production ones.
 */
function fileTable(entries: Record<string, Buffer | undefined>) {
  const digestByPath = new Map(
    spec.files.map((file) => [`${spec.physicalKey}/${file.path}`, file.sha256]),
  )
  return {
    readFile: async (path: string) => {
      const bytes = entries[path]
      if (bytes === undefined) throw new Error(`no such file: ${path}`)
      return new Uint8Array(bytes)
    },
    stat: async (path: string) => {
      const bytes = entries[path]
      if (bytes === undefined) throw new Error(`no such file: ${path}`)
      return { size: bytes.length }
    },
    hashFile: async (path: string) => {
      if (entries[path] === undefined) throw new Error(`no such file: ${path}`)
      const digest = digestByPath.get(path)
      if (digest === undefined) return createHash('sha256').update(entries[path]!).digest('hex')
      return digest
    },
  }
}

function correctBundle(): Record<string, Buffer | undefined> {
  const entries: Record<string, Buffer | undefined> = {}
  for (const file of spec.files) {
    entries[`${spec.physicalKey}/${file.path}`] = Buffer.alloc(file.bytes)
  }
  entries[`${spec.physicalKey}/manifest.json`] = Buffer.from(JSON.stringify(manifestOf(spec)))
  return entries
}

describe('verifySemanticBundle', () => {
  it('accepts a bundle whose manifest, sizes, and digests all agree', async () => {
    const entries = correctBundle()
    await expect(
      verifySemanticBundle(spec.physicalKey, spec, fileTable(entries)),
    ).resolves.toBeUndefined()
  })

  it('refuses a missing manifest', async () => {
    const entries = correctBundle()
    delete entries[`${spec.physicalKey}/manifest.json`]
    await expect(
      verifySemanticBundle(spec.physicalKey, spec, fileTable(entries)),
    ).rejects.toMatchObject({
      code: ZOTERO_ENRICHMENT_SEMANTIC_UNAVAILABLE,
      message: expect.stringContaining('manifest.json is missing'),
    })
  })

  it('refuses a manifest that disagrees with the catalog', async () => {
    const entries = correctBundle()
    const manifest = JSON.parse(entries[`${spec.physicalKey}/manifest.json`]!.toString())
    manifest.revision = '0'.repeat(40)
    entries[`${spec.physicalKey}/manifest.json`] = Buffer.from(JSON.stringify(manifest))
    await expect(verifySemanticBundle(spec.physicalKey, spec, fileTable(entries))).rejects.toThrow(
      /disagrees with the catalog/,
    )
  })

  it('refuses a missing or wrong-size file', async () => {
    const entries = correctBundle()
    delete entries[`${spec.physicalKey}/config.json`]
    await expect(verifySemanticBundle(spec.physicalKey, spec, fileTable(entries))).rejects.toThrow(
      /config\.json is missing/,
    )

    const resized = correctBundle()
    // A file at the wrong size: the manifest and the catalog still agree, so
    // the size check is what trips.
    resized[`${spec.physicalKey}/tokenizer.json`] = Buffer.alloc(1)
    await expect(verifySemanticBundle(spec.physicalKey, spec, fileTable(resized))).rejects.toThrow(
      /tokenizer\.json is \d+ bytes, expected/,
    )
  })

  it('refuses a digest mismatch', async () => {
    const entries = correctBundle()
    // Swap the digest seam for one that answers a wrong digest, so only the
    // catalog's pinned digest can catch the corruption.
    const tampered = fileTable(entries)
    tampered.hashFile = async (path: string) =>
      path.endsWith('config.json')
        ? createHash('sha256').update('corrupted').digest('hex')
        : (spec.files.find((file) => `${spec.physicalKey}/${file.path}` === path)?.sha256 ?? '')
    await expect(verifySemanticBundle(spec.physicalKey, spec, tampered)).rejects.toThrow(
      /config\.json failed its SHA-256 check/,
    )
    return
    await expect(verifySemanticBundle(spec.physicalKey, spec, fileTable(entries))).rejects.toThrow(
      /config\.json failed its SHA-256 check/,
    )
  })
})

describe('openSemanticEmbedder', () => {
  it('propagates the verifier refusal instead of opening a session', async () => {
    const entries = correctBundle()
    delete entries[`${spec.physicalKey}/manifest.json`]
    await expect(
      openSemanticEmbedder(spec, spec.physicalKey, fileTable(entries) as never),
    ).rejects.toMatchObject({ code: ZOTERO_ENRICHMENT_SEMANTIC_UNAVAILABLE })
  })
})
