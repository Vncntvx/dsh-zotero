import { afterEach, beforeEach, expect, it } from 'vitest'
import { MockZotero } from '../../helpers/mock-zotero.js'
import { createProvider, retrieveRequest } from '../../helpers/provider-harness.js'
import { apiPath } from '../../helpers/server/keys.js'
import { attachment } from '../../helpers/server/objects.js'
import { serveItemGraph } from '../../helpers/server/serve.js'
import { deferred } from '../../helpers/sync.js'

let mock: MockZotero
beforeEach(async () => {
  mock = await MockZotero.start()
})
afterEach(async () => {
  await mock.close()
})

const entries = [
  { key: 'SHORT001', content: 'a' },
  { key: 'LONG0001', content: 'bcd' },
  { key: 'LONG0002', content: 'efg' },
  { key: 'EMPTY001', content: '' },
]

it.each([
  { budget: 1, allocation: [1, 0, 0, 0] },
  { budget: 2, allocation: [0, 1, 1, 0] },
  { budget: 6, allocation: [1, 2, 3, 0] },
])(
  'allocates a strict $budget-character budget independently of completion order',
  async ({ budget, allocation }) => {
    serveItemGraph(mock, { children: entries.map(({ key }) => attachment({ key })) })
    const provider = createProvider(mock, { maxFulltextChars: budget, graphConcurrency: 4 })
    const gatesOf = () =>
      new Map(
        entries.map(({ key }) => [
          key,
          { arrival: deferred(), reply: deferred(), sent: deferred() },
        ]),
      )
    let gates = gatesOf()
    for (const { key, content } of entries) {
      mock.route(
        'GET',
        `${apiPath()}/items/${key}/fulltext`,
        async (_request, response, helpers) => {
          const gate = gates.get(key)!
          response.once('finish', () => gate.sent.resolve())
          gate.arrival.resolve()
          await gate.reply.promise
          helpers.json({ content })
        },
      )
    }
    const read = async (ordered: typeof entries) => {
      gates = gatesOf()
      const pending = provider.retrieve(
        retrieveRequest({
          sources: ['fulltext'],
          attachmentPolicy: 'allIndexed',
          query: 'a b c d e f g bc efg',
        }),
      )
      await Promise.all(Array.from(gates.values(), ({ arrival }) => arrival.promise))
      for (const { key } of ordered) {
        const { reply, sent } = gates.get(key)!
        reply.resolve()
        await sent.promise
      }
      return pending
    }
    const forward = await read(entries)
    const backward = await read([...entries].reverse())
    expect(backward).toEqual(forward)
    expect(forward.attachments).toHaveLength(entries.length)
    expect(forward.attachments).toEqual(
      expect.arrayContaining(
        entries.map(({ key, content }, index) =>
          expect.objectContaining({
            ref: expect.stringContaining(key),
            status: 'indexed',
            passages: allocation[index] === 0 ? 0 : 1,
            inputTruncated: allocation[index]! < content.length,
          }),
        ),
      ),
    )
    expect(
      forward.evidence.reduce((count, passage) => count + passage.text.length, 0),
    ).toBeLessThanOrEqual(budget)
  },
)
