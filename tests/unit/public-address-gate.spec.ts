/**
 * One matrix for the two gates every public fetch passes: the spelling and the
 * answer.
 *
 * The upstream fetch provider this plugin could otherwise lean on answers
 * intranet and loopback addresses by design — it checks the scheme and the URL
 * length, nothing else — so there is no upstream address judgment to inherit.
 * `isPublicUrl` judges the spelling and `isPublicIpAddress` judges what DNS
 * answered; a name that passes the first is still refused when the second
 * fails. Each row below is named and states which gate must refuse it, so
 * replacing either gate with the upstream scheme/length check (or with the
 * other gate) turns the matrix red.
 * @module tests/unit/public-address-gate
 */

import { describe, expect, it } from 'vitest'
import { isPublicUrl } from '../../src/transport/public-url.ts'
import {
  resolvePublicAddresses,
  type AddressResolver,
  type ResolvedAddress,
} from '../../src/transport/network.ts'

const PUBLIC_V4 = { address: '93.184.216.34', family: 4 } as const
const LOOPBACK_V4 = { address: '127.0.0.1', family: 4 } as const
const PRIVATE_V4 = { address: '192.168.1.10', family: 4 } as const

interface MatrixRow {
  readonly name: string
  readonly url: string
  /** What the name resolves to; unused when the lexical gate refuses it. */
  readonly answers: readonly ResolvedAddress[]
  /** Which gate must refuse the row, or undefined when it is admitted. */
  readonly refusedBy: 'lexical' | 'address' | undefined
}

const ROWS: readonly MatrixRow[] = [
  {
    name: 'admits a publisher name with a public answer',
    url: 'https://www.nature.com/articles/x.pdf',
    answers: [PUBLIC_V4],
    refusedBy: undefined,
  },
  {
    name: 'admits an explicit default port with a public answer',
    url: 'https://www.nature.com:443/articles/x.pdf',
    answers: [PUBLIC_V4],
    refusedBy: undefined,
  },
  {
    // This is the row the upstream provider cannot enforce: the name is
    // ordinary, and only the resolved answer exposes the loopback.
    name: 'refuses a public name answering loopback',
    url: 'https://localtest.me/paper.pdf',
    answers: [LOOPBACK_V4],
    refusedBy: 'address',
  },
  {
    name: 'refuses a public name answering a private address',
    url: 'https://papers.example.org/x.pdf',
    answers: [PRIVATE_V4],
    refusedBy: 'address',
  },
  {
    name: 'refuses one private answer among public ones',
    url: 'https://papers.example.org/x.pdf',
    answers: [PUBLIC_V4, PRIVATE_V4],
    refusedBy: 'address',
  },
  {
    name: 'refuses a non-standard port without resolving it',
    url: 'https://papers.example.org:8443/x.pdf',
    answers: [PUBLIC_V4],
    refusedBy: 'lexical',
  },
  {
    name: 'refuses an intranet suffix without resolving it',
    url: 'http://printer.internal/x.pdf',
    answers: [PUBLIC_V4],
    refusedBy: 'lexical',
  },
  {
    name: 'refuses a single-label host without resolving it',
    url: 'http://intranet/x.pdf',
    answers: [PUBLIC_V4],
    refusedBy: 'lexical',
  },
  {
    name: 'refuses an IPv6 literal without resolving it',
    url: 'https://[2606:4700:4700::1111]/x.pdf',
    answers: [{ address: '2606:4700:4700::1111', family: 6 }],
    refusedBy: 'lexical',
  },
  {
    name: 'refuses a non-HTTP scheme',
    url: 'ftp://papers.example.org/x.pdf',
    answers: [PUBLIC_V4],
    refusedBy: 'lexical',
  },
]

describe('public fetch address matrix', () => {
  it.each(ROWS)('$name', async ({ url, answers, refusedBy }) => {
    const lexicallyPublic = isPublicUrl(url)
    if (refusedBy === 'lexical') {
      expect(lexicallyPublic, 'the lexical gate must refuse it').toBe(false)
      return
    }
    expect(lexicallyPublic, 'the lexical gate must admit it').toBe(true)
    // The resolver seam answers exactly what the row says; nothing here opens
    // a socket or resolves a real name.
    const resolver: AddressResolver = async () => answers
    const resolution = resolvePublicAddresses(new URL(url).hostname, resolver)
    if (refusedBy === 'address') {
      await expect(resolution).rejects.toMatchObject({ name: 'PublicAddressError' })
      return
    }
    await expect(resolution).resolves.toEqual(answers)
  })
})
