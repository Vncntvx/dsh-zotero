import { expect, it } from 'vitest'
import {
  DEFAULT_JOURNAL_METRIC_LIST,
  journalMetricListRulesOf,
  journalMetricListValues,
} from '../../src/journal-metrics.js'

const defaults = DEFAULT_JOURNAL_METRIC_LIST
const metrics = (...fields: string[]) => fields.map((field) => ({ field, value: 'value' }))

it('uses the matching preset and fills the JCR candidate from SSCI when needed', () => {
  const international = metrics('sciif', 'sciUp', 'ssci', 'ccf')
  expect(journalMetricListValues(international, defaults, false).map(({ field }) => field)).toEqual(
    ['ssci', 'sciif', 'sciUp'],
  )
  expect(journalMetricListValues(metrics('cscd', 'pku', 'cufe'), defaults, false)).toEqual(
    metrics('cscd', 'pku'),
  )
})

it('chooses one preset for dual coverage and respects both display limits', () => {
  const dual = metrics('sci', 'sciif', 'sciUp', 'cssci', 'pku', 'zhongguokejihexin')
  expect(journalMetricListValues(dual, defaults, true)).toEqual(metrics('sci', 'sciif'))
  expect(
    journalMetricListValues(dual, { ...defaults, dualPriority: 'chineseCore', limit: 1 }, false),
  ).toEqual(metrics('cssci'))
  expect(journalMetricListValues(dual, { ...defaults, international: ['sciif'] }, false)).toEqual(
    metrics('sciif'),
  )
})

it('applies only configured candidates for journals outside either set and deduplicates fallbacks', () => {
  const rules = { ...defaults, international: ['jcr', 'ssci', 'ccf'] } as const
  expect(journalMetricListValues(metrics('ccf', 'unknown'), rules, false)).toEqual(metrics('ccf'))
  expect(journalMetricListValues(metrics('unknown'), rules, false)).toEqual([])
  expect(journalMetricListValues(metrics('ssci', 'ccf'), rules, false)).toEqual(
    metrics('ssci', 'ccf'),
  )
})

it('migrates legacy defaults and preserves custom metric order and its display limit', () => {
  expect(journalMetricListRulesOf(['sci', 'sciif', 'sciUp'])).toEqual(defaults)
  expect(journalMetricListRulesOf(['sciif', 'ccf', 'pku'])).toEqual({
    international: ['sciif', 'ccf'],
    chineseCore: ['ccf', 'pku'],
    dualPriority: 'international',
    limit: 3,
  })
  expect(journalMetricListRulesOf(['pku'])).toEqual({
    ...defaults,
    chineseCore: ['pku'],
    limit: 1,
  })
  expect(journalMetricListRulesOf(['sciif'])).toEqual({
    ...defaults,
    international: ['sciif'],
    limit: 1,
  })
})
