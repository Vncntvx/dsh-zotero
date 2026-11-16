/** Static shell variants that must reach the same approval boundary. */
import { expect, it } from 'vitest'
import { detectShellWrite } from '../../src/shell-write-detector.js'

const baseUrl = 'http://127.0.0.1:23119/api'
const detects = (command: string, url = baseUrl) =>
  detectShellWrite({ baseUrl: url }, { name: 'bash', arguments: { command } })

it.each([
  `curl -d $'note=it\\'s;still a body' ${baseUrl}/users/0/items`,
  `curl -d "note=quoted\\\";still a body" ${baseUrl}/users/0/items`,
  `curl -d 'note=PowerShell''s;body' ${baseUrl}/users/0/items`,
  `curl -d note=escaped\\;body ${baseUrl}/users/0/items`,
  `curl -X POST ${baseUrl}/users/0/items \\`,
])('preserves escaped and doubled quotes while retaining the write: %s', (command) => {
  expect(detects(command)).toBeDefined()
})

it.each([';', '|', '&&', '&nbsp;'])(
  'keeps %s inside an inline payload attached to its request',
  (separator) => {
    expect(
      detects(`curl -d '{"note":"before${separator}after"}' ${baseUrl}/users/0/items`),
    ).toBeDefined()
  },
)

it.each(['http', 'https', 'http --form', 'http --json'])(
  'recognizes %s with HTTPie body fields',
  (client) => {
    expect(detects(`${client} ${baseUrl}/users/0/items title=value`)).toBeDefined()
    expect(detects(`${client} ${baseUrl}/users/0/items title:=123`)).toBeDefined()
  },
)

it.each([
  '0.0.0.0',
  '127.1',
  '127.42.1.9',
  '2130706433',
  '0x7f000001',
  '[::ffff:127.0.0.1]',
  '[0:0:0:0:0:0:0:1]',
])('canonicalizes the local address %s before testing writes and authorization', (host) => {
  expect(detects(`curl -X POST http://${host}:23119/api/users/0/items`)).toBeDefined()
  expect(detects(`curl http://${host}:9999/api/local/authorize`)).toBeDefined()
})

it('keeps a long interpreter body in one logical command and follows literal assignments', () => {
  expect(
    detects(
      `python -c "url='${baseUrl}/users/0/items'; padding='${'x'.repeat(500)}'; requests.post(url, json={})"`,
    ),
  ).toBeDefined()
  expect(detects(`METHOD=POST; curl -X "$METHOD" ${baseUrl}/users/0/items`)).toBeDefined()
  expect(
    detects(`URL='${baseUrl}/users/0/items'; METHOD=POST; curl -X "\${METHOD}" "$URL"`),
  ).toBeDefined()
})

it('joins a raw HTTP request with the local socket consuming its pipeline', () => {
  expect(
    detects("printf 'POST /api/users/0/items HTTP/1.1\\r\\n' | nc 127.0.0.1 23119"),
  ).toBeDefined()
})

it('uses the scheme default port when no explicit port appears in the configuration', () => {
  expect(detects('curl -X POST http://127.1/api/items', 'http://127.0.0.1/api')).toBeDefined()
  expect(detects('curl -X POST https://localhost/api/items', 'https://127.0.0.1/api')).toBeDefined()
})

it.each([
  `curl '${baseUrl}/users/0/items?a=1&b=2' && echo POST`,
  `http GET ${baseUrl}/users/0/items`,
  `http ${baseUrl}/users/0/items?limit=1`,
  `http ${baseUrl}/users/0/items limit==1`,
  'curl -X POST https://localhost.evil.example/api/items',
  'curl -X POST https://127.0.0.1.evil.example/api/items',
])('preserves a read or unrelated host: %s', (command) => {
  expect(detects(command)).toBeUndefined()
})
