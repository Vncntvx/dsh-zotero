import { describe, expect, it } from 'vitest'
import { ZOTERO_WRITE_DISABLED } from '../../src/errors.js'
import type { ZoteroService } from '../../src/service.js'
import { writePolicyDecision } from '../../src/tools/write-approval.js'

/** Minimal service stand-in: only the live config the gate reads. */
function serviceWith(writeEnabled: boolean): ZoteroService {
  return { config: { writeEnabled } } as ZoteroService
}

describe('writePolicyDecision', () => {
  it('ignores non-write tools', () => {
    const decision = writePolicyDecision(serviceWith(false), { name: 'zotero_search' })
    expect(decision).toBeUndefined()
  })

  it('allows write tools while the capability is on', () => {
    const decision = writePolicyDecision(serviceWith(true), { name: 'zotero_create_note' })
    expect(decision).toBeUndefined()
  })

  it('denies with structured reason when the capability is off', () => {
    const decision = writePolicyDecision(serviceWith(false), { name: 'zotero_create_note' })
    expect(decision).toMatchObject({
      kind: 'deny',
      info: {
        name: 'ZoteroError',
        code: ZOTERO_WRITE_DISABLED,
        reason:
          'The write capability is off in the Zotero settings page (writeEnabled: false); enable it before calling write tools.',
      },
    })
    if (decision?.kind !== 'deny') throw new Error('unreachable')
    expect(decision.reason).toContain('Writing to Zotero is disabled')
  })
})
