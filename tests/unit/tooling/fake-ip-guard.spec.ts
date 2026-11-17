/** Security gate rejects extra arms and loss of the TLS/name binding. */
import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import { expect, it } from 'vitest'
import { fakeIpPolicyIssues } from '../../../scripts/fake-ip-guard.mjs'

const root = process.cwd()
function sources() {
  const files: Array<[string, string]> = []
  const visit = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) visit(path)
      else if (/\.tsx?$/.test(path))
        files.push([relative(root, path).replaceAll('\\', '/'), readFileSync(path, 'utf8')])
    }
  }
  visit(join(root, 'src'))
  return files
}

it('admits the current reviewed production arms', () => {
  expect(fakeIpPolicyIssues(sources())).toEqual([])
})

it('rejects a fourth arm even when the property uses a computed string name', () => {
  expect(
    fakeIpPolicyIssues([
      ...sources(),
      [
        'src/library/extra.ts',
        "resolvePublicAddresses(host, resolver, { ['acceptFakeIp']: true })",
      ],
    ]),
  ).toContain('src/library/extra.ts: unreviewed fake-IP egress arm')
})

it.each(['src/scholarly/transport/http.ts', 'src/enrichment/transport.ts'])(
  'rejects weakening the HTTPS gate in %s',
  (path) => {
    const changed = sources().map(([name, text]): [string, string] => [
      name,
      name === path
        ? text.replace(
            /(?:target|parsed)\.protocol === 'https:' && !isIpv4Literal\(hostname\)/,
            'true',
          )
        : text,
    ])
    expect(fakeIpPolicyIssues(changed)).toContain(
      `${path}: fake-IP acceptance requires HTTPS and a DNS hostname`,
    )
  },
)

it('rejects replacing the reviewed allowlist predicate with a wider predicate', () => {
  const changed = sources().map(([name, text]): [string, string] => [
    name,
    text.replace(
      'createValidatingDispatcher(isAllowedScholarlyHost)',
      'createValidatingDispatcher(() => true)',
    ),
  ])
  expect(fakeIpPolicyIssues(changed)).toContain(
    'src/scholarly/transport/http.ts: unreviewed hostname-based fake-IP dispatcher',
  )
})
