/**
 * The live write probe. Double-gated (`ZOTERO_INTEGRATION=1` AND
 * `ZOTERO_WRITE_PROBE=1`), because it writes to the connected library. All
 * writes stay inside one probe-owned collection (`[dsh-zotero-probe]`,
 * created on demand), so the blast radius is one collection the operator can
 * delete afterwards. The probe walks the full write path for real: the
 * authorize dialog (a human answers it in Zotero), a created note read back
 * through the batch's successful bucket, the note's stored HTML (asserting
 * Zotero's own schema wrapper), tags merged with a version precondition, an
 * item added to the probe collection, a deliberately lost precondition, and
 * the library version the writes advanced.
 *
 *   ZOTERO_INTEGRATION=1 ZOTERO_WRITE_PROBE=1 npx vitest run tests/integration/write-probe.integration.spec.ts
 *
 * Zotero must be running with the local API enabled and someone at the
 * keyboard to answer the authorization dialogs.
 * @module tests/integration/write-probe
 */

import { beforeAll, describe, expect, it } from 'vitest'
import type { ZoteroHttpClient } from '../../src/http-client.js'
import type { ZoteroWriteHttpClient } from '../../src/write-http.js'
import { WriteAuthorizer } from '../../src/write-auth.js'
import { PERSONAL_LIBRARY } from '../../src/refs.js'
import { resolveCollectionsMixed, ScopeDirectory } from '../../src/local/scope-directory.js'
import {
  createNote,
  fetchItemTypeFields,
  updateItemTags,
  type WriteDomainDeps,
} from '../../src/local/write-domain.js'
import { testHttpClient, testWriteClient } from '../helpers/test-clients.js'

const BASE_URL = process.env.ZOTERO_BASE_URL ?? 'http://127.0.0.1:23119/api'
const PROBE_COLLECTION = '[dsh-zotero-probe]'

describe.runIf(process.env.ZOTERO_INTEGRATION === '1' && process.env.ZOTERO_WRITE_PROBE === '1')(
  'live write probe (ZOTERO_INTEGRATION=1 AND ZOTERO_WRITE_PROBE=1)',
  () => {
    let client: ZoteroHttpClient
    let writer: ZoteroWriteHttpClient
    let authorizer: WriteAuthorizer
    let directory: ScopeDirectory
    let deps: WriteDomainDeps
    let serverId = ''

    beforeAll(async () => {
      client = testHttpClient(BASE_URL, {
        timeoutMs: 10_000,
        maxResponseBytes: 64 * 1024 * 1024,
      })
      writer = testWriteClient(BASE_URL, {
        timeoutMs: 10_000,
        maxResponseBytes: 64 * 1024 * 1024,
      })
      authorizer = new WriteAuthorizer({ client: writer, persistKey: () => true })
      // TTL 0: every listing read goes to the live server, so the probe never
      // trusts a cache while it mutates the library.
      directory = new ScopeDirectory(client, () => 0)
      await client.get('', undefined, {})
      serverId = client.serverId ?? ''
      expect(serverId).not.toBe('')
      deps = {
        client,
        writer,
        authorizer,
        resolveCollection: (refOrName, signal) =>
          resolveCollectionsMixed(
            directory,
            [refOrName],
            PERSONAL_LIBRARY,
            signal,
            client.serverId,
          ).then((refs) => refs[0]!),
        resolveCollections: (inputs, signal) =>
          resolveCollectionsMixed(directory, inputs, PERSONAL_LIBRARY, signal, client.serverId),
        itemTypeFields: (itemType, signal) => fetchItemTypeFields({ client }, itemType, signal),
      }
    })

    it('authorizes through the Zotero dialog', async () => {
      await expect(authorizer.keyFor(serverId)).resolves.toBeDefined()
    })

    it('creates a note in the probe collection and reads the saved state back', async () => {
      const result = await createNote(deps, {
        markdown: '# dsh-zotero write probe\n\nCreated **live** at the probe run.',
        collections: [PROBE_COLLECTION],
        tags: ['dsh-zotero-probe'],
      })
      expect(result.kind).toBe('applied')
      const saved = await client.getJson<Record<string, unknown>>(
        `users/0/items/${result.key}`,
        undefined,
        {},
      )
      const data = (saved.json as { data?: Record<string, unknown> }).data ?? {}
      const note = String(data.note ?? '')
      expect(note).toContain('<h1>')
      expect(note).toContain('<strong>live</strong>')
      expect(JSON.stringify(data.tags)).toContain('dsh-zotero-probe')
    })

    it('merges tags under the version precondition and refuses a stale one', async () => {
      const result = await createNote(deps, { markdown: 'probe note two' })
      expect(result.kind).toBe('applied')
      if (result.kind !== 'applied') throw new Error('expected an applied note')
      await expect(
        updateItemTags(deps, {
          item: { library: { type: 'user', id: 0 }, kind: 'item', key: result.key },
          add: ['probe-tag-2'],
        }),
      ).resolves.toMatchObject({ unchanged: false })
      // A stale precondition (version 1) must lose: the domain reports the
      // conflict instead of overwriting.
      await expect(
        writer.patch(
          `users/0/items/${result.key}`,
          { tags: [{ tag: 'probe-tag-2' }] },
          {
            serverId,
            apiKey: await authorizer.keyFor(serverId).then((k) => k.key),
            ifUnmodifiedSinceVersion: 1,
          },
        ),
      ).rejects.toMatchObject({ code: 'ZOTERO_WRITE_CONFLICT' })
    })

    it('advances the library version the read client sees', async () => {
      const { headers } = await client.get('', undefined, {})
      const version = Number(headers.get('last-modified-version'))
      expect(Number.isFinite(version)).toBe(true)
      expect(version).toBeGreaterThan(0)
    })
  },
)
