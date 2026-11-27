// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest'
import {
  CLAIM_RELATIONS,
  EVIDENCE_REVIEWS,
  claimLinkOf,
  claimPassageKey,
  linkClaim,
  readClaims,
  writeClaims,
} from '../../../src/client/components/workspace/claim-evidence.ts'
import type { Claim } from '../../../src/client/components/workspace/claim-evidence.ts'
import { passageOf, sourceOf } from '../helpers/source-fixtures.ts'

afterEach(() => sessionStorage.clear())

const source = sourceOf({
  key: 'source',
  evidence: [passageOf({ sourceRef: 'zotero://user/0/attachment/ABCD1234', text: 'Finding' })],
})

function link(relation: (typeof CLAIM_RELATIONS)[number] = 'supports') {
  return claimLinkOf(source.key, source.evidence[0]!, relation, EVIDENCE_REVIEWS[0])
}

it('rejects malformed stored claims, oversized writes, and invalid links', () => {
  sessionStorage.setItem('dsh-zotero:claims:v1:session', '{')
  expect(readClaims('session')).toEqual([])
  sessionStorage.setItem('dsh-zotero:claims:v1:session', JSON.stringify([{ id: 'not-a-uuid' }]))
  expect(readClaims('session')).toEqual([])
  expect(writeClaims('session', [{ id: crypto.randomUUID(), text: 'x', evidence: [] }])).toBe(true)
  expect(
    writeClaims('session', [{ id: crypto.randomUUID(), text: 'x'.repeat(300_000), evidence: [] }]),
  ).toBe(false)
  expect(linkClaim([], crypto.randomUUID(), '', link())).toBeUndefined()
  expect(linkClaim([], '', 'Claim', { ...link(), relation: 'unknown' as never })).toBeUndefined()
})

it('replaces an existing link, appends a new one, and refuses a 25th link', () => {
  const first: Claim = { id: crypto.randomUUID(), text: 'Claim', evidence: [link()] }
  const replacement = { ...link('refutes') }
  const replaced = linkClaim([first], first.id, '', replacement)
  expect(replaced?.[0]?.evidence).toEqual([replacement])

  const appended = linkClaim([first], first.id, '', { ...link('limits'), passage: 'Second' })
  expect(appended?.[0]?.evidence).toHaveLength(2)

  const full: Claim = {
    ...first,
    evidence: Array.from({ length: 24 }, (_, index) => ({
      ...link(),
      passage: `Passage ${index}`,
    })),
  }
  expect(linkClaim([full], full.id, '', { ...link(), passage: 'Overflow' })).toBeUndefined()
})

it('creates a claim only when the statement is valid and the claim cap allows it', () => {
  const created = linkClaim([], '', '  New claim  ', link())
  expect(created).toMatchObject([{ text: 'New claim', evidence: [link()] }])
  expect(claimPassageKey(created![0]!.evidence[0]!)).toContain('Finding')

  const full = Array.from({ length: 32 }, (_, index) => ({
    id: crypto.randomUUID(),
    text: `Claim ${index}`,
    evidence: [link()],
  })) as Claim[]
  expect(linkClaim(full, '', 'Another claim', link())).toBeUndefined()
  expect(linkClaim([], 'existing-id', 'Another claim', link())).toBeUndefined()
})
