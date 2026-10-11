/**
 * Search episode scope resolution from resolved search metadata: library,
 * publications, collection, and savedSearch scopes.
 * @module tests/client/sources/reducer-scopes
 */

import { describe, expect, it } from 'vitest'
import { buildSourceWorkspace } from '../../../src/client/sources/reducer.ts'
import { REF, block, searchMetaOf, searchOccurrenceOf } from './reducer-fixtures.ts'

describe('buildSourceWorkspace - resolved search scopes', () => {
  it('maps resolved scopes across library, publications, collection, and savedSearch', () => {
    const workspace = buildSourceWorkspace([
      block(
        's1',
        1,
        'zotero_search',
        { query: 'test' },
        {
          meta: searchMetaOf([{ ref: REF('A1') }], 0, {
            scope: { kind: 'library', library: { type: 'user', id: 0 } },
            library: { type: 'user', id: 0 },
          }),
        },
      ),
      block(
        's2',
        2,
        'zotero_search',
        { query: 'test' },
        {
          meta: searchMetaOf([{ ref: REF('A2') }], 0, {
            scope: { kind: 'publications', library: { type: 'user', id: 0 } },
            library: { type: 'user', id: 0 },
          }),
        },
      ),
      block(
        's3',
        3,
        'zotero_search',
        { query: 'test' },
        {
          meta: searchMetaOf([{ ref: REF('A3') }], 0, {
            scope: {
              kind: 'collection',
              ref: 'zotero://user/0/collection/C1',
              name: 'Reading List',
            },
            library: { type: 'user', id: 0 },
          }),
        },
      ),
      block(
        's4',
        4,
        'zotero_search',
        { query: 'test' },
        {
          meta: searchMetaOf([{ ref: REF('A4') }], 0, {
            scope: {
              kind: 'savedSearch',
              ref: 'zotero://user/0/search/S1',
              name: 'Saved S1',
            },
            library: { type: 'user', id: 0 },
          }),
        },
      ),
    ])

    expect(workspace.sources).toHaveLength(4)
    expect(workspace.sources[0]?.searches).toEqual([
      searchOccurrenceOf({
        callId: 's1',
        query: 'test',
        scope: { kind: 'library', library: { type: 'user', id: 0 } },
        library: { type: 'user', id: 0 },
      }),
    ])
    expect(workspace.sources[1]?.searches).toEqual([
      searchOccurrenceOf({
        callId: 's2',
        query: 'test',
        scope: { kind: 'publications', library: { type: 'user', id: 0 } },
        library: { type: 'user', id: 0 },
      }),
    ])
    expect(workspace.sources[2]?.searches).toEqual([
      searchOccurrenceOf({
        callId: 's3',
        query: 'test',
        scope: {
          kind: 'collection',
          ref: 'zotero://user/0/collection/C1',
          name: 'Reading List',
        },
        library: { type: 'user', id: 0 },
      }),
    ])
    expect(workspace.sources[3]?.searches).toEqual([
      searchOccurrenceOf({
        callId: 's4',
        query: 'test',
        scope: {
          kind: 'savedSearch',
          ref: 'zotero://user/0/search/S1',
          name: 'Saved S1',
        },
        library: { type: 'user', id: 0 },
      }),
    ])
  })
})
