/**
 * The deterministic entry chunkers: BibTeX entries by citation key, RIS
 * records by id, CSL JSON records by id — never indexed against the
 * requested refs, so Zotero's own entry order is irrelevant.
 * @module tests/client/sources/export-entries
 */

import { describe, expect, it } from 'vitest'
import {
  bibtexEntriesOf,
  csljsonEntriesOf,
  risEntriesOf,
} from '../../../src/client/sources/export-entries.ts'

describe('bibtexEntriesOf', () => {
  it('chunks entries by citation key, from each entry start to the next', () => {
    const text = '@article{pan2022,\n  title = {A},\n}\n\n@book{zheng2025,\n  title = {B},\n}\n'
    const chunks = bibtexEntriesOf(text)
    expect([...chunks.keys()]).toEqual(['pan2022', 'zheng2025'])
    expect(chunks.get('pan2022')).toBe('@article{pan2022,\n  title = {A},\n}')
    expect(chunks.get('zheng2025')).toBe('@book{zheng2025,\n  title = {B},\n}')
  })

  it('keeps the first entry of a duplicated key', () => {
    const chunks = bibtexEntriesOf('@article{a,\n}\n@article{a,\n  title = {Second},\n}')
    expect(chunks.get('a')).toBe('@article{a,\n}')
  })

  it('returns empty for a body without parseable entries', () => {
    expect(bibtexEntriesOf('plain text')).toEqual(new Map())
    expect(bibtexEntriesOf('')).toEqual(new Map())
  })
})

describe('risEntriesOf', () => {
  const TEXT =
    'TY  - JOUR\nTI  - A\nID  - ABCD1234\nER  -\n\nTY  - JOUR\nTI  - B\nID  - BBBB1234\nER  -\n'

  it('splits records on ER lines and keys them by their id', () => {
    const chunks = risEntriesOf(TEXT)
    expect([...chunks.keys()]).toEqual(['ABCD1234', 'BBBB1234'])
    expect(chunks.get('ABCD1234')).toBe('TY  - JOUR\nTI  - A\nID  - ABCD1234')
    expect(chunks.get('BBBB1234')).toBe('TY  - JOUR\nTI  - B\nID  - BBBB1234')
  })

  it('handles a trailing record without a terminator', () => {
    const chunks = risEntriesOf(
      'TY  - JOUR\nID  - ABCD1234\nER  -\n\nTY  - JOUR\nTI  - B\nID  - BBBB1234\n',
    )
    expect([...chunks.keys()]).toEqual(['ABCD1234', 'BBBB1234'])
    expect(chunks.get('BBBB1234')).toBe('TY  - JOUR\nTI  - B\nID  - BBBB1234')
  })

  it('returns empty for records without an id', () => {
    expect(risEntriesOf('TY  - JOUR\nTI  - A\nER  -\n')).toEqual(new Map())
    expect(risEntriesOf('')).toEqual(new Map())
  })

  it('skips a trailing fragment without an id', () => {
    const chunks = risEntriesOf('TY  - JOUR\nID  - ABCD1234\nER  -\n\njunk tail')
    expect([...chunks.keys()]).toEqual(['ABCD1234'])
  })
})

describe('csljsonEntriesOf', () => {
  it('keys each record by its id with the record re-serialized', () => {
    const text = JSON.stringify([
      { id: 'wang2023', title: 'Carbon trading' },
      { id: 'pan2022', title: 'Carbon pricing' },
    ])
    const chunks = csljsonEntriesOf(text)
    expect([...chunks.keys()]).toEqual(['wang2023', 'pan2022'])
    expect(JSON.parse(chunks.get('wang2023')!)).toEqual({ id: 'wang2023', title: 'Carbon trading' })
    expect(JSON.parse(chunks.get('pan2022')!)).toEqual({ id: 'pan2022', title: 'Carbon pricing' })
  })

  it('skips records without a string id', () => {
    expect(csljsonEntriesOf('[{"title": "no id"}, {"id": 7}]')).toEqual(new Map())
    expect(csljsonEntriesOf('[{"id": ""}]')).toEqual(new Map())
    expect(csljsonEntriesOf('[null, "junk"]')).toEqual(new Map())
    expect(csljsonEntriesOf('[]')).toEqual(new Map())
  })

  it('returns empty for unparseable or non-array bodies', () => {
    expect(csljsonEntriesOf('not json')).toEqual(new Map())
    expect(csljsonEntriesOf('{}')).toEqual(new Map())
  })
})
