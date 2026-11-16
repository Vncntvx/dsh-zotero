/** Browser navigation accepts only explicit web links without userinfo. */
import { expect, it } from 'vitest'
import { webUrlOf } from '../../src/client/actions/web-url.ts'

it.each([
  undefined,
  '',
  'relative/paper',
  'javascript:alert(1)',
  'data:text/html,attack',
  'file:///tmp/a',
  'https://user:secret@example.org/paper',
])('refuses a non-web or credential-bearing link: %s', (value) => {
  expect(webUrlOf(value)).toBeUndefined()
})

it.each(['http://example.org/paper', 'https://example.org/paper'])(
  'retains an explicit web destination: %s',
  (value) => {
    expect(webUrlOf(value)).toBe(value)
  },
)
