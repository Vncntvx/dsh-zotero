/** Unknown keys and missing dynamic-field bases fail the whole-key inventory check. */
import { expect, it } from 'vitest'
import { unusedLocaleKeys } from '../../../scripts/locale-usage.mjs'

it('does not treat comments or the suffix of an absent group as usage', () => {
  expect(
    unusedLocaleKeys(
      ['used', 'dead', 'groupLibrarySidebarDesc'],
      [['view.ts', "t('used'); // t('dead')"]],
    ),
  ).toEqual(['dead', 'groupLibrarySidebarDesc'])
})

it('admits the actual field-key transforms without allowing every Hint or Desc key', () => {
  expect(
    unusedLocaleKeys(
      [
        'maxResultsHint',
        'scholarlyMaxResults',
        'scholarlyMaxResultsHint',
        'groupReadDesc',
        'unusedHint',
      ],
      [['form.ts', "const fields = ['maxResults']; const groups = ['groupRead']"]],
    ),
  ).toEqual(['unusedHint'])
})
