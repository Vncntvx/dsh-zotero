/**
 * A local address rejection is not an index outage.
 *
 * When every source fails because the local DNS or proxy answered with a
 * placeholder the address gate refused, the tool must say so instead of
 * telling the reader to wait for the indexes to recover. Deterministic policy
 * refusals and remote failures keep the original wording, and a partial
 * failure counts the local refusals the same way.
 * @module tests/scholarly/local-rejection-wording
 */

import { describe, expect, it } from 'vitest'
import { PublicAddressError } from '../../src/transport/public-url.js'
import { LOCAL_CONDITION_NOTE, REMOTE_RECOVERY_NOTE } from '../../src/scholarly/tools/failure.js'
import {
  createScholarlyGetTool,
  createScholarlySearchTool,
  createScholarlyVerifyTool,
} from '../../src/scholarly/tools/index.js'
import { EXEC_CONTEXT, createMockHost, createMockHttp } from './fixtures.js'

function fakeIpFailure(): TypeError {
  return new TypeError('fetch failed', {
    cause: new PublicAddressError(
      'Security rejection: "api.openalex.org" resolves to a non-public address (198.18.4.25). A local DNS proxy (Clash/mihomo TUN) answers with this fake-IP placeholder; add the host to its fake-ip-filter or switch the DNS mode to redir-host.',
      'non-public-address',
    ),
  })
}

function policyFailure(): TypeError {
  return new TypeError('fetch failed', {
    cause: new PublicAddressError(
      'Security rejection: Host "api.openalex.org" is not on the scholarly allowlist.',
      'policy',
    ),
  })
}

describe('scholarly_search all-local failure wording', () => {
  it('names the local condition instead of an index outage', async () => {
    const host = createMockHost(
      createMockHttp(() => {
        throw fakeIpFailure()
      }),
    )
    const tool = createScholarlySearchTool(host)

    const result = (await tool.execute({ query: 'attention mechanism' }, EXEC_CONTEXT as any)) as {
      text: string
    }

    expect(result.text).toContain('No scholarly index could be reached')
    expect(result.text).toContain(LOCAL_CONDITION_NOTE)
    expect(result.text).not.toContain(REMOTE_RECOVERY_NOTE)
  })

  it('keeps the index-recovery wording for remote failures', async () => {
    const host = createMockHost(createMockHttp(() => new Response('not found', { status: 404 })))
    const tool = createScholarlySearchTool(host)

    const result = (await tool.execute({ query: 'attention mechanism' }, EXEC_CONTEXT as any)) as {
      text: string
    }

    expect(result.text).toContain(REMOTE_RECOVERY_NOTE)
    expect(result.text).not.toContain(LOCAL_CONDITION_NOTE)
  })

  it('keeps the index-recovery wording for deterministic policy refusals', async () => {
    const host = createMockHost(
      createMockHttp(() => {
        throw policyFailure()
      }),
    )
    const tool = createScholarlySearchTool(host)

    const result = (await tool.execute({ query: 'attention mechanism' }, EXEC_CONTEXT as any)) as {
      text: string
    }

    expect(result.text).toContain(REMOTE_RECOVERY_NOTE)
    expect(result.text).not.toContain(LOCAL_CONDITION_NOTE)
  })
})

describe('scholarly_get all-local failure wording', () => {
  it('names the local condition instead of an index outage', async () => {
    const host = createMockHost(
      createMockHttp(() => {
        throw fakeIpFailure()
      }),
    )
    const tool = createScholarlyGetTool(host)

    const result = (await tool.execute({ id: '10.9999/outage.paper' }, EXEC_CONTEXT as any)) as {
      text: string
    }

    expect(result.text).toContain('Nothing is known about this identifier')
    expect(result.text).toContain(LOCAL_CONDITION_NOTE)
    expect(result.text).not.toContain(REMOTE_RECOVERY_NOTE)
  })

  it('keeps the index-recovery wording for remote failures', async () => {
    // 404 is normalized to "the registry holds no such work" by several
    // lookups, so the remote-failure case uses a status that is a failure.
    const host = createMockHost(createMockHttp(() => new Response('forbidden', { status: 403 })))
    const tool = createScholarlyGetTool(host)

    const result = (await tool.execute({ id: '10.9999/outage.paper' }, EXEC_CONTEXT as any)) as {
      text: string
    }

    expect(result.text).toContain(REMOTE_RECOVERY_NOTE)
    expect(result.text).not.toContain(LOCAL_CONDITION_NOTE)
  })
})

describe('scholarly_verify all-local failure wording', () => {
  it('names the local condition instead of a Crossref outage', async () => {
    const host = createMockHost(
      createMockHttp(() => {
        throw fakeIpFailure()
      }),
    )
    const tool = createScholarlyVerifyTool(host, { background: false })

    const result = (await tool.execute(
      { references: ['10.9999/outage.paper'] },
      EXEC_CONTEXT as any,
    )) as { text: string; checks: Array<Record<string, unknown>> }

    expect(result.text).toContain(LOCAL_CONDITION_NOTE)
    expect(result.text).not.toContain('after Crossref recovers')
    expect(result.text).toContain('not an index outage')
    // The internal classification marker never enters the tool's JSON contract.
    expect(result.checks[0]).not.toHaveProperty('localRejection')
  })
})
