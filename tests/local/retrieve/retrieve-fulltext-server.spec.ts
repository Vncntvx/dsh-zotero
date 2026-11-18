import { expect, it } from 'vitest'
import { ZOTERO_SERVER_MISMATCH } from '../../../src/errors.js'
import { retrieveRequest } from '../../helpers/provider-harness.js'
import { requestLines } from '../../helpers/server/assert.js'
import { apiPath, attachmentRef } from '../../helpers/server/keys.js'
import { attachment, versionHeaders } from '../../helpers/server/objects.js'
import { serveItemGraph, serveJson } from '../../helpers/server/serve.js'
import { RETRIEVE_ATTACHMENT, RETRIEVE_PARENT } from '../../helpers/retrieve-fixtures.js'
import { boot, enhancerOf, hit, providerOf } from './support/fulltext.js'

const source = { kind: 'ref', ref: attachmentRef(RETRIEVE_ATTACHMENT.key) } as const
const attachmentPath = `${apiPath()}/items/${RETRIEVE_ATTACHMENT.key}`
const parentPath = `${apiPath()}/items/${RETRIEVE_PARENT.key}`
const bodyPath = `${attachmentPath}/fulltext`

it.each(['attachment', 'parent', 'body'])(
  'rejects a different instance in the %s response',
  async (foreign) => {
    const server = await boot(false)
    serveJson(
      server,
      attachmentPath,
      RETRIEVE_ATTACHMENT,
      versionHeaders(foreign === 'attachment' ? 'S2' : 'S1'),
    )
    serveJson(
      server,
      parentPath,
      RETRIEVE_PARENT,
      versionHeaders(foreign === 'parent' ? 'S2' : 'S1'),
    )
    serveJson(
      server,
      bodyPath,
      { content: 'foreign text' },
      versionHeaders(foreign === 'body' ? 'S2' : 'S1'),
    )
    await expect(
      providerOf(server).retrieve({
        mode: 'fulltext',
        source: { ...source, ref: `${source.ref}?server=S1` },
        complete: true,
      }),
    ).rejects.toMatchObject({ code: ZOTERO_SERVER_MISMATCH })
    expect(requestLines(server)).toEqual(
      [attachmentPath, parentPath, bodyPath].slice(
        0,
        ['attachment', 'parent', 'body'].indexOf(foreign) + 1,
      ),
    )
  },
)

it('discovers an instance for an unqualified PDF and retains it through a headerless parent read', async () => {
  const server = await boot(false)
  serveJson(server, attachmentPath, RETRIEVE_ATTACHMENT, versionHeaders('S1'))
  serveJson(server, parentPath, RETRIEVE_PARENT)
  const enhancer = enhancerOf(hit('Parsed text'))
  const result = await providerOf(server, enhancer).retrieve({
    mode: 'fulltext',
    source,
    complete: true,
  })
  const ref = `${source.ref}?server=S1`
  expect(result.fulltext).toMatchObject({ attachmentRef: ref, text: 'Parsed text' })
  expect(result.fulltext.item?.ref).toMatch(/\?server=S1$/)
  expect(enhancer.lookup).toHaveBeenCalledWith(
    expect.objectContaining({
      source: { kind: 'local', attachmentRef: ref },
      contentType: 'application/pdf',
    }),
    undefined,
  )
  expect(requestLines(server)).toEqual([attachmentPath, parentPath])
  expect(server.requests[1]?.headers['zotero-server-id']).toBe('S1')
})

it('skips the enhancer for a standalone text attachment and uses the claimed instance on headerless responses', async () => {
  const server = await boot(false)
  serveJson(
    server,
    attachmentPath,
    attachment({
      key: RETRIEVE_ATTACHMENT.key,
      data: { contentType: 'text/plain', parentItem: false },
    }),
    {},
  )
  serveJson(server, bodyPath, { content: 'Index text' }, {})
  const enhancer = enhancerOf(hit('Not this text'))
  const ref = `${source.ref}?server=S1`
  const result = await providerOf(server, enhancer).retrieve({
    mode: 'fulltext',
    source: { ...source, ref },
    complete: true,
  })
  expect(result.fulltext).toMatchObject({
    attachmentRef: ref,
    attachmentContentType: 'text/plain',
    text: 'Index text',
  })
  expect(result.fulltext.item).toBeUndefined()
  expect(enhancer.lookup).not.toHaveBeenCalled()
  expect(requestLines(server)).toEqual([attachmentPath, bodyPath])
})

it.each(['best', 'allIndexed'] as const)(
  'validates index identity in the %s evidence path',
  async (attachmentPolicy) => {
    const server = await boot(false)
    serveItemGraph(server, {
      parent: RETRIEVE_PARENT,
      children: [RETRIEVE_ATTACHMENT],
      serverId: 'S1',
    })
    serveJson(server, bodyPath, { content: 'foreign text' }, versionHeaders('S2'))
    await expect(
      providerOf(server).retrieve(retrieveRequest({ attachmentPolicy, sources: ['fulltext'] })),
    ).rejects.toMatchObject({ code: ZOTERO_SERVER_MISMATCH })
  },
)
