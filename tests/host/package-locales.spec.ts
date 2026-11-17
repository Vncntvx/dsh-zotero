/** Display metadata has one dictionary; settings labels belong to client form locales. */
import { readdirSync, readFileSync } from 'node:fs'
import { expect, it } from 'vitest'

const root = new URL('../../locale/', import.meta.url)
const paths = readdirSync(root, { recursive: true }).filter(
  (path): path is string => typeof path === 'string' && path.endsWith('.json'),
)

it.each(paths)('keeps %s restricted to package display metadata', (path) => {
  const bundle = JSON.parse(readFileSync(new URL(path, root), 'utf8'))
  expect(Object.keys(bundle)).toEqual(['meta'])
  expect(Object.keys(bundle.meta)).toEqual(expect.arrayContaining(['description', 'title']))
  expect(
    Object.keys(bundle.meta).filter((key) => !['description', 'detail', 'title'].includes(key)),
  ).toEqual([])
  for (const value of Object.values(bundle.meta))
    expect(typeof value === 'string' && value.trim().length > 0).toBe(true)
})
