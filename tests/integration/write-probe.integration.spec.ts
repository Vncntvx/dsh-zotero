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
import { parseSupportedRef, PERSONAL_LIBRARY, requireWritableRef } from '../../src/refs.js'
import { resolveCollectionsMixed, ScopeDirectory } from '../../src/local/scope-directory.js'
import { createItem, updateItem } from '../../src/local/write-domain.js'
import { createAnnotations, deleteAnnotation } from '../../src/local/write-annotations.js'
import type { WriteDomainDeps } from '../../src/local/write-deps.js'
import { createNote, modifyNote, updateNote } from '../../src/local/write-notes.js'
import { noteTextRuns } from '../../src/local/note-text-edits.js'
import { restoreItems } from '../../src/local/write-library-maintenance.js'
import { updateItemTags } from '../../src/local/write-item-lists.js'
import { batchItems } from '../../src/local/write-batch.js'
import { createCollection } from '../../src/local/write-collections.js'
import { ItemSchemaDirectory } from '../../src/local/item-schema-directory.js'
import { testHttpClient, testWriteClient } from '../helpers/test-clients.js'

const BASE_URL = process.env.ZOTERO_BASE_URL ?? 'http://127.0.0.1:23119/api'
const PROBE_COLLECTION = '[dsh-zotero-probe]'
const READER_PROBE_TITLE = '[dsh-zotero-reader-probe]'
const readerProbeRef = process.env.ZOTERO_READER_PROBE_ATTACHMENT

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
      directory = new ScopeDirectory(
        client,
        () => 0,
        () => 4,
      )
      await client.get('', undefined, {})
      serverId = client.serverId ?? ''
      expect(serverId).not.toBe('')
      // The desktop prompt uses the write client's human-paced deadline.
      await expect(authorizer.keyFor(serverId)).resolves.toBeDefined()
      const itemSchema = new ItemSchemaDirectory(client)
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
        itemTypeFields: (itemType, signal) => itemSchema.getWritableItemFields(itemType, signal),
      }
    }, 180_000)

    it('prepares the probe collection through the authorized Local API', async () => {
      const listing = await directory.scopeListingOf(
        'collections',
        { library: PERSONAL_LIBRARY, serverId },
        undefined,
      )
      if (
        !listing.entries.some(
          (entry) => entry.name === PROBE_COLLECTION && entry.parentKey === undefined,
        )
      ) {
        const created = await createCollection(deps, { name: PROBE_COLLECTION })
        if (created.kind !== 'applied')
          throw new Error(
            'probe collection creation was not verified; reconcile before another run',
          )
      }
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
      const result = await createNote(deps, {
        markdown: 'probe note two',
        collections: [PROBE_COLLECTION],
      })
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

    it('updates, trashes and restores a probe-owned child note using its real wire shape', async () => {
      const parent = await createItem(deps, {
        itemType: 'document',
        title: 'dsh-zotero child write probe',
        collections: [PROBE_COLLECTION],
      })
      if (parent.kind !== 'applied') throw new Error('parent creation was not verified')
      const parentRef = { library: PERSONAL_LIBRARY, kind: 'item' as const, key: parent.key }
      const note = await createNote(deps, { parentItem: parentRef, markdown: 'Child write probe' })
      if (note.kind !== 'applied') throw new Error('child creation was not verified')
      const noteRef = { library: PERSONAL_LIBRARY, kind: 'item' as const, key: note.key }
      const read = async () =>
        (
          await client.getJson<{
            data: {
              parentItem: string
              note: string
              collections?: string[]
              deleted?: number | boolean
            }
          }>(`users/0/items/${note.key}`, undefined, {})
        ).json.data
      expect((await read()).collections).toBeUndefined()
      await updateNote(deps, { item: noteRef, markdown: '**Updated child**' })
      expect((await read()).note).toContain('<strong>Updated child</strong>')
      const trashed = await batchItems(deps, { delete: [noteRef] })
      expect(trashed.failed).toEqual([])
      expect(Boolean((await read()).deleted)).toBe(true)
      const restored = await restoreItems(deps, { items: [noteRef] })
      expect(restored.failed).toEqual([])
      expect(restored.restored).toHaveLength(1)
      const saved = await read()
      expect(Boolean(saved.deleted)).toBe(false)
      expect(saved.parentItem).toBe(parent.key)
    })

    it('advances the library version the read client sees', async () => {
      const { headers } = await client.get('users/0/items', new URLSearchParams({ limit: '1' }), {})
      const version = Number(headers.get('last-modified-version'))
      expect(Number.isFinite(version)).toBe(true)
      expect(version).toBeGreaterThan(0)
    })

    it.runIf(readerProbeRef !== undefined)(
      'creates, edits, and deletes a version-pinned Reader note on the probe PDF’s parent',
      async () => {
        const fixture = parseSupportedRef(readerProbeRef!, ['attachment'])
        expect(fixture.serverId).toBe(serverId)
        const read = async (key: string) =>
          (
            await client.getJson<{ data: Record<string, unknown>; version: number }>(
              `users/0/items/${key}`,
              undefined,
              { serverId },
            )
          ).json
        const { data } = await read(fixture.key)
        expect(data).toMatchObject({ itemType: 'attachment', title: READER_PROBE_TITLE })
        const parentItem = requireWritableRef(
          parseSupportedRef(`zotero://user/0/item/${data.parentItem}?server=${serverId}`, ['item']),
          ['item'],
        )
        const note = await createNote(deps, {
          parentItem,
          markdown: `**Original finding**\n\n[Source](zotero://open-pdf/library/items/${fixture.key}?page=1)`,
        })
        if (note.kind !== 'applied') throw new Error('Reconcile the probe note in Zotero')
        const item = parseSupportedRef(note.ref, ['item'])
        const before = await read(item.key)
        expect(before.data.parentItem).toBe(parentItem.key)
        const original = String(before.data.note)
        const target = noteTextRuns(original).find(({ text }) => text === 'Original finding')
        if (!target) throw new Error('The saved probe text is missing')
        const result = await modifyNote(deps, {
          operation: 'edit',
          item,
          expectedVersion: before.version,
          edits: [{ offset: target.offset, text: 'Revised <finding>' }],
        })
        expect(result.kind).toBe('applied')
        const after = await read(item.key)
        expect(after.data.note).toBe(
          original.replace('Original finding', 'Revised &lt;finding&gt;'),
        )
        const deletion = { operation: 'delete', item, expectedVersion: before.version } as const
        await expect(modifyNote(deps, deletion)).rejects.toMatchObject({
          code: 'ZOTERO_WRITE_CONFLICT',
        })
        await expect(
          modifyNote(deps, { ...deletion, expectedVersion: after.version }),
        ).resolves.toMatchObject({ kind: 'applied' })
        await expect(read(item.key)).rejects.toMatchObject({ code: 'ZOTERO_NOT_FOUND' })
      },
      180_000,
    )

    it.runIf(readerProbeRef !== undefined)(
      'creates, edits, and deletes Zotero Reader annotations on the designated probe PDF',
      async () => {
        const ref = requireWritableRef(parseSupportedRef(readerProbeRef!, ['attachment']), [
          'attachment',
        ])
        expect(ref.serverId, 'Supply an attachment ref pinned to this live instance').toBe(serverId)
        const read = async (key: string) =>
          (
            await client.getJson<{ data: Record<string, unknown>; version: number }>(
              `users/0/items/${key}`,
              undefined,
              { serverId },
            )
          ).json
        const attachment = (await read(ref.key)).data
        expect(attachment).toMatchObject({
          itemType: 'attachment',
          contentType: 'application/pdf',
          title: READER_PROBE_TITLE,
        })

        const created = await createAnnotations(deps, {
          attachment: ref,
          type: 'highlight',
          color: '#ffd400',
          comment: 'Reader integration probe',
          pages: [0, 1].map((pageIndex) => ({
            pageIndex,
            text: 'Sample reader text',
            pageLabel: String(pageIndex + 1),
            textOffset: 0,
            top: 35,
            rects: [{ x: 28, y: 40, width: 46, height: 15 }],
          })),
        })
        expect(created.failed).toEqual([])
        expect(created.unverified).toEqual([])
        expect(created.created).toHaveLength(2)

        for (const { key, ref: annotationRef, index, version } of created.created) {
          const annotation = parseSupportedRef(annotationRef, ['annotation'])
          const saved = await read(key)
          expect(saved.version).toBe(version)
          expect(saved.data).toMatchObject({
            itemType: 'annotation',
            parentItem: ref.key,
            annotationType: 'highlight',
            annotationPosition: JSON.stringify({ pageIndex: index, rects: [[28, 40, 74, 55]] }),
          })

          const updated = await updateItem(deps, {
            item: annotation,
            expectedVersion: version,
            set: { annotationType: 'underline', annotationComment: 'Reviewed fixture' },
            tagChanges: { add: ['reader-probe'] },
          })
          expect(updated.kind).toBe('applied')
          if (updated.kind !== 'applied')
            throw new Error('Reconcile the probe annotation in Zotero')
          const current = await read(key)
          expect(current.data).toMatchObject({
            annotationType: 'underline',
            annotationComment: 'Reviewed fixture',
            tags: [expect.objectContaining({ tag: 'reader-probe' })],
          })
          await expect(
            deleteAnnotation(deps, { annotation, expectedVersion: version }),
          ).rejects.toMatchObject({
            code: 'ZOTERO_WRITE_CONFLICT',
          })
          await expect(
            deleteAnnotation(deps, { annotation, expectedVersion: current.version }),
          ).resolves.toMatchObject({
            kind: 'deleted',
            ref: annotationRef,
          })
          await expect(read(key)).rejects.toMatchObject({ code: 'ZOTERO_NOT_FOUND' })
        }
      },
      180_000,
    )
  },
)
