/** The security-support table follows the package release line. */
import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'

it('names the current major/minor line as supported and older lines as unsupported', () => {
  const root = new URL('../../', import.meta.url)
  const manifest = JSON.parse(readFileSync(new URL('package.json', root), 'utf8')) as {
    version: string
  }
  const [major, minor] = manifest.version.split('.')
  const table = readFileSync(new URL('SECURITY.md', root), 'utf8').split('## Reporting')[0]!
  const rows = table.split('\n').map((line) => line.split('|').map((cell) => cell.trim()))
  expect(
    rows.filter((cells) => cells[2] === ':white_check_mark:').map((cells) => cells[1]),
  ).toEqual([`${major}.${minor}.x`])
  expect(rows.filter((cells) => cells[2] === ':x:').map((cells) => cells[1])).toEqual([
    `< ${major}.${minor}`,
  ])
})
