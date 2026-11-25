import { expect, it } from 'vitest'
import { JournalMetrics } from '../../../src/library/journal-metrics.js'

const secret = 'test-easyscholar-secret'

async function lookup(response: Response) {
  const service = new JournalMetrics({
    reference: () => 'EASYSCHOLAR_SECRET_KEY',
    credential: async () => secret,
    fetch: async () => response,
  })
  try {
    return await service.lookup({ publicationName: 'Journal', priority: 'detail' })
  } finally {
    await service.dispose()
  }
}

it('returns official and valid custom fields while keeping upstream error text and credentials private', async () => {
  const result = await lookup(
    Response.json({
      code: 200,
      data: {
        officialRank: {
          all: { sci: 'Q1', futureMetric: 'value', sciif: 3.5, empty: '', echo: secret, bad: {} },
          select: { sci: 'Q2', pku: '核心' },
        },
        customRank: {
          rankInfo: [{ uuid: '1614986460329492480', abbName: 'DUFE', threeRankText: 'B' }, null],
          rank: [
            '1614986460329492480',
            '1614986460329492480&&&0',
            '1614986460329492480&&&3',
            1,
            '1&&&2',
          ],
        },
      },
    }),
  )
  expect(result).toMatchObject({
    status: 'ready',
    official: [
      { field: 'sci', value: 'Q1' },
      { field: 'pku', value: '核心' },
      { field: 'futureMetric', value: 'value' },
      { field: 'sciif', value: '3.5' },
    ],
    custom: [{ id: '1614986460329492480', label: 'DUFE', value: 'B' }],
  })
  expect(JSON.stringify(result)).not.toContain(secret)
})

// Synthetic responses exercise the parser independently of a live credential.
it.each([
  ['null all', { all: null, select: { sci: 'Q1' } }],
  ['omitted all', { select: { sci: 'Q1' } }],
  ['null select', { all: { sci: 'Q1' }, select: null }],
])('keeps official metrics with %s and an empty custom rank', async (_name, officialRank) => {
  await expect(
    lookup(Response.json({ code: 200, data: { officialRank, customRank: null } })),
  ).resolves.toMatchObject({
    status: 'ready',
    official: [{ field: 'sci', value: 'Q1' }],
    custom: [],
  })
})

it('accepts a success with both rank groups null', async () => {
  await expect(
    lookup(Response.json({ code: 200, data: { officialRank: null, customRank: null } })),
  ).resolves.toMatchObject({ status: 'ready', official: [], custom: [] })
})

it.each([
  ['invalid select despite valid all', { officialRank: { all: { sci: 'Q1' }, select: [] } }],
  ['invalid all despite valid select', { officialRank: { all: 'Q1', select: { sci: 'Q1' } } }],
  ['missing official fields', { officialRank: {} }],
  ['missing custom arrays', { customRank: {} }],
  ['invalid rankInfo', { customRank: { rankInfo: null, rank: [] } }],
])('rejects %s', async (_name, data) => {
  await expect(lookup(Response.json({ code: 200, data }))).resolves.toEqual({
    status: 'invalidResponse',
  })
})
