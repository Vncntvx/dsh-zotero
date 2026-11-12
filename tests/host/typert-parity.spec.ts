/**
 * The hand-written typert manifest against the services it describes.
 *
 * The workspace generator cannot run in this repository (it reads a pnpm
 * workspace layout and `tsconfig.host.json`/`tsconfig.client.json` under
 * `packages/**`), so `src/typert.ts` is written by hand. Nothing else checks
 * that its `members[].name` list still names the methods the gateway will
 * actually look up: a renamed or deleted endpoint would keep compiling and
 * fail at call time with "method not found".
 *
 * Two invariants ride here. Every wire method a service exposes is declared,
 * and every declared member is a method the service exposes. A prototype
 * helper that the gateway never invokes by name is listed in
 * {@link NON_WIRE_MEMBERS} — the list is checked in both directions, so a
 * helper that disappears must leave the list too.
 * @module tests/host/typert-parity
 */

import { describe, expect, it } from 'vitest'
import { TYPERT_MANIFEST } from '../../src/typert.js'
import { ZoteroRuntime } from '../../src/remote.js'
import { ZoteroLibraryService } from '../../src/library/service.js'
import { EnrichmentService } from '../../src/enrichment/service.js'
import { ZOTERO_LIBRARY_SERVICE_KEY, ZOTERO_STATUS_SERVICE_KEY } from '../../src/contract.js'
import { ZOTERO_ENRICHMENT_SERVICE_KEY } from '../../src/settings-namespace.js'

/** The class behind each manifest service key. */
const SERVICE_CLASSES = new Map<unknown, { new (...args: never[]): object; name: string }>([
  [ZOTERO_STATUS_SERVICE_KEY, ZoteroRuntime],
  [ZOTERO_LIBRARY_SERVICE_KEY, ZoteroLibraryService],
  [ZOTERO_ENRICHMENT_SERVICE_KEY, EnrichmentService],
])

/**
 * Prototype members that are not wire methods: helpers the gateway never
 * invokes by name. Each service's list is exhaustive in both directions.
 */
const NON_WIRE_MEMBERS: Readonly<Record<string, readonly string[]>> = {
  [ZOTERO_STATUS_SERVICE_KEY]: ['debugEnabled'],
  [ZOTERO_LIBRARY_SERVICE_KEY]: ['readResolvedUrlPdf'],
  // `lookup` is the core's FulltextEnhancer seam, `parseWire`/`storeFor` are
  // component internals, and the cache-generation methods are the in-process
  // protocol the semantic ranker uses to hold a model generation open. None of
  // them is an endpoint.
  [ZOTERO_ENRICHMENT_SERVICE_KEY]: [
    'acquireCacheGeneration',
    'lookup',
    'maybeDisposeCacheGeneration',
    'parseWire',
    'releaseCacheGeneration',
    'retireActiveCache',
    'storeFor',
  ],
}

/** The prototype member names of one class, `constructor` excluded. */
function prototypeMembers(klass: { prototype: object }): string[] {
  return Object.getOwnPropertyNames(klass.prototype)
    .filter((name) => name !== 'constructor')
    .sort()
}

describe('the hand-written typert manifest matches the services it describes', () => {
  it('declares exactly the wire methods each service exposes', () => {
    const violations: string[] = []
    for (const service of TYPERT_MANIFEST.model.services) {
      const key = String(service.key)
      const klass = SERVICE_CLASSES.get(service.key)
      if (klass === undefined) {
        violations.push(`${key}: no service class is registered for this manifest key`)
        continue
      }
      const exempt = new Set(NON_WIRE_MEMBERS[key] ?? [])
      const wire = prototypeMembers(klass).filter((name) => !exempt.has(name))
      const declared = service.members.map((member) => member.name).sort()
      const missing = wire.filter((name) => !declared.includes(name))
      const extra = declared.filter((name) => !wire.includes(name))
      if (missing.length > 0) {
        violations.push(`${key}: manifest omits ${missing.join(', ')}`)
      }
      if (extra.length > 0) {
        violations.push(
          `${key}: manifest declares ${extra.join(', ')}, which the class does not expose`,
        )
      }
    }
    expect(violations).toEqual([])
  })

  it('lists no non-wire exemption the class no longer has', () => {
    // A stale exemption would quietly widen the check above.
    const violations: string[] = []
    for (const [key, exempt] of Object.entries(NON_WIRE_MEMBERS)) {
      const klass = SERVICE_CLASSES.get(key)
      if (klass === undefined) {
        violations.push(`${key}: exemption for an unknown service`)
        continue
      }
      const members = prototypeMembers(klass)
      for (const name of exempt) {
        if (!members.includes(name)) violations.push(`${key}: exemption ${name} is gone`)
      }
    }
    expect(violations).toEqual([])
  })

  it('spells every signature with the member it declares', () => {
    // The signature text is what the generated client sees; a copy-pasted
    // signature that names another method is worse than none.
    const violations: string[] = []
    for (const service of TYPERT_MANIFEST.model.services) {
      for (const member of service.members) {
        if (member.kind !== 'method') continue
        if (!member.signature.startsWith(`${member.name}(`)) {
          violations.push(
            `${String(service.key)} ${member.name}: signature starts "${member.signature.slice(0, 40)}"`,
          )
        }
      }
    }
    expect(violations).toEqual([])
  })

  it('declares every invocation method on the service it targets', () => {
    const violations: string[] = []
    for (const invocation of TYPERT_MANIFEST.invocations) {
      const service = TYPERT_MANIFEST.model.services.find(
        (candidate) => candidate.key === invocation.service,
      )
      if (service === undefined) {
        violations.push(`${invocation.method}: no manifest service ${String(invocation.service)}`)
        continue
      }
      if (!service.members.some((member) => member.name === invocation.method)) {
        violations.push(
          `${String(invocation.service)}: invocation ${invocation.method} has no member`,
        )
      }
    }
    expect(violations).toEqual([])
  })
})
