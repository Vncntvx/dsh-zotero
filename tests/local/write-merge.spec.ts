import { describe, expect, it } from 'vitest'
import { mergeList, mergeTagList } from '../../src/local/write-domain.js'

describe('mergeList', () => {
  it('keeps saved entries, appends only genuinely new ones, and reports the moves', () => {
    expect(mergeList(['a', 'b'], ['b'], ['c', 'a'])).toEqual({
      merged: ['a', 'c'],
      added: ['c'],
      removed: ['b'],
      changed: true,
    })
  })

  it('reports no change when the request adds only what is already saved', () => {
    expect(mergeList(['a', 'b'], [], ['a', 'b'])).toEqual({
      merged: ['a', 'b'],
      added: [],
      removed: [],
      changed: false,
    })
  })

  it('ignores removals that name no saved entry', () => {
    expect(mergeList(['a'], ['ghost'], [])).toEqual({
      merged: ['a'],
      added: [],
      removed: [],
      changed: false,
    })
  })

  it('lets the removal win when a saved entry is named in both lists', () => {
    expect(mergeList(['a', 'b'], ['a'], ['a', 'c'])).toEqual({
      merged: ['b', 'c'],
      added: ['c'],
      removed: ['a'],
      changed: true,
    })
  })

  it('collapses duplicate additions and duplicate saved entries', () => {
    expect(mergeList(['a', 'a'], [], ['b', 'b'])).toEqual({
      merged: ['a', 'a', 'b'],
      added: ['b'],
      removed: [],
      changed: true,
    })
    expect(mergeList(['a', 'a'], ['a'], [])).toEqual({
      merged: [],
      added: [],
      removed: ['a'],
      changed: true,
    })
  })

  it('empties the list when every saved entry is removed', () => {
    expect(mergeList(['a', 'b'], ['a', 'b'], [])).toEqual({
      merged: [],
      added: [],
      removed: ['a', 'b'],
      changed: true,
    })
  })
})

describe('mergeTagList', () => {
  it('preserves each retained tag type and leaves new tags untyped', () => {
    expect(
      mergeTagList(
        [{ tag: 'colored', type: 1 }, { tag: 'automatic', type: 2 }, { tag: 'plain' }],
        ['automatic'],
        ['colored', 'fresh'],
      ),
    ).toEqual({
      merged: [{ tag: 'colored', type: 1 }, { tag: 'plain' }, { tag: 'fresh' }],
      added: ['fresh'],
      removed: ['automatic'],
      changed: true,
    })
  })

  it('mirrors mergeList semantics when nothing changes', () => {
    expect(mergeTagList([{ tag: 'plain' }], ['ghost'], ['plain'])).toEqual({
      merged: [{ tag: 'plain' }],
      added: [],
      removed: [],
      changed: false,
    })
  })

  it('removes a saved tag named in both lists, type included', () => {
    expect(mergeTagList([{ tag: 'colored', type: 1 }], ['colored'], ['colored'])).toEqual({
      merged: [],
      added: [],
      removed: ['colored'],
      changed: true,
    })
  })
})
