/** All search entry points share Zotero's literal-tag boundary. */
import { expect, it } from 'vitest'
import { zoteroLibraryFiltersSchema } from '../../src/wire-schemas.js'
import { assertLiteralSearchTags, buildSearchParams } from '../../src/local/search-query.js'
import { request } from '../helpers/provider-harness.js'

it.each(['A||B', ' ', '\n\t', ''])(
  'rejects the ambiguous tag %j at both panel and domain boundaries',
  (tag) => {
    expect(zoteroLibraryFiltersSchema.safeParse({ tags: [tag] }).success).toBe(false)
    // The domain gate (search-domain's pre-I/O assert) and the tool layer both
    // route through this check; the encoder only escapes what survived it.
    expect(() => assertLiteralSearchTags(request({ tags: [tag] }))).toThrow('literal tag')
    expect(() => assertLiteralSearchTags(request({ excludeTags: [tag] }))).toThrow('literal tag')
  },
)

it('preserves literal leading hyphens and joins only distinct accepted tags as OR', () => {
  const tags = ['-literal', 'Tag A']
  expect(zoteroLibraryFiltersSchema.parse({ tags }).tags).toEqual(tags)
  expect(buildSearchParams(request({ tags, tagMatch: 'any' })).get('tag')).toBe(
    '\\-literal || Tag A',
  )
})
