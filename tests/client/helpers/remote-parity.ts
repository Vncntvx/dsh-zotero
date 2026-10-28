/**
 * The shared runner for the wire-contract parity specs: one table-driven
 * harness that fixes each boundary's strict codec on both arms and holds
 * them to the same verdicts over hand-written samples.
 * @module tests/client/helpers/remote-parity
 */

import { describe, expect, it } from 'vitest'
import type { InvocationDescriptor } from '@deepseek-ai/dsh-typert-protocol'
import { ZOTERO_REMOTE } from '../../../src/client/remote.ts'
import { TYPERT_MANIFEST } from '../../../src/typert.ts'

/** The `{ mode, typeSymbol, create }` arm both halves hand the wire. */
export interface BoundaryCodec {
  readonly mode: string
  readonly typeSymbol: string
  readonly create: () => { parse: (value: unknown) => unknown }
}

/** Which end of an invocation a boundary sits on. */
export type Boundary =
  { readonly kind: 'result' } | { readonly kind: 'param'; readonly index: number }

/**
 * One wire boundary plus the verdicts both codec arms must reach. The sample
 * lists are hand-written per field on purpose: they regression-test the shared
 * schema in `wire-schemas.ts` against the wire contract itself — a
 * reflection-based comparison would only re-state the schema — and they fail
 * if an arm's wrapper is wired to the wrong schema or dropped.
 */
export interface ParityCase {
  /** The invocation method that carries the boundary. */
  readonly method: string
  /** Which end of that invocation it is. */
  readonly boundary: Boundary
  /** Human label used in failure messages. */
  readonly wire: string
  /** The strict typeSymbol the shared contract fixes for it. */
  readonly typeSymbol: string
  /** A value both arms must accept, to equal parsed results. */
  readonly valid: unknown
  /** Each entry omits a member the schema requires. */
  readonly incomplete: readonly unknown[]
  /** Each entry puts a member at a type the schema does not declare. */
  readonly malformed: readonly unknown[]
  /** Each entry adds a member `.strict()` must refuse. */
  readonly undeclared: readonly unknown[]
  /** Each entry names an enum member outside the declared set. */
  readonly badEnum: readonly unknown[]
}

/** Locate one boundary's codec on a descriptor. */
function codecAt(descriptor: InvocationDescriptor, boundary: Boundary): BoundaryCodec {
  if (boundary.kind === 'result') return descriptor.result as BoundaryCodec
  const parameter = descriptor.parameters[boundary.index]
  if (parameter === undefined) {
    throw new Error(`${descriptor.method} has no parameter at index ${boundary.index}`)
  }
  return parameter.codec as BoundaryCodec
}

/** Locate an invocation on either half by wire method. */
function invocationOf(
  invocations: readonly InvocationDescriptor[],
  method: string,
): InvocationDescriptor {
  const found = invocations.find((entry) => entry.method === method)
  if (found === undefined) throw new Error(`no invocation for ${method}`)
  return found
}

/**
 * Register the parity suite for one endpoint family.
 * @param cases - the boundaries and their hand-written samples.
 */
export function runRemoteParitySpec(cases: readonly ParityCase[]): void {
  describe('host/client schema parity', () => {
    for (const testCase of cases) {
      it(`fixes one strict codec on both arms for the ${testCase.wire}`, () => {
        const hostCodec = codecAt(
          invocationOf(TYPERT_MANIFEST.invocations, testCase.method),
          testCase.boundary,
        )
        const clientCodec = codecAt(
          invocationOf(ZOTERO_REMOTE.descriptors, testCase.method),
          testCase.boundary,
        )
        expect(hostCodec.mode).toBe('strict')
        expect(clientCodec.mode).toBe('strict')
        expect(hostCodec.typeSymbol).toBe(testCase.typeSymbol)
        expect(clientCodec.typeSymbol).toBe(testCase.typeSymbol)
        expect(typeof hostCodec.create).toBe('function')
        expect(typeof clientCodec.create).toBe('function')
      })

      it(`holds both arms to the same verdicts on the ${testCase.wire}`, () => {
        const hostParse = codecAt(
          invocationOf(TYPERT_MANIFEST.invocations, testCase.method),
          testCase.boundary,
        ).create()
        const clientParse = codecAt(
          invocationOf(ZOTERO_REMOTE.descriptors, testCase.method),
          testCase.boundary,
        ).create()
        // A case whose refusal lists all emptied out would pass vacuously.
        const refusals = [
          ...testCase.incomplete,
          ...testCase.malformed,
          ...testCase.undeclared,
          ...testCase.badEnum,
        ]
        expect(refusals.length, testCase.wire).toBeGreaterThanOrEqual(3)

        const hostAccepted = hostParse.parse(testCase.valid)
        expect(hostAccepted, testCase.wire).toEqual(testCase.valid)
        expect(clientParse.parse(testCase.valid), testCase.wire).toEqual(hostAccepted)

        const groups: readonly (readonly [string, readonly unknown[]])[] = [
          ['incomplete', testCase.incomplete],
          ['malformed', testCase.malformed],
          ['undeclared', testCase.undeclared],
          ['bad-enum', testCase.badEnum],
        ]
        for (const [group, samples] of groups) {
          for (const sample of samples) {
            expect(() => hostParse.parse(sample), `${testCase.wire} ${group}`).toThrow()
            expect(() => clientParse.parse(sample), `${testCase.wire} ${group}`).toThrow()
          }
        }
      })
    }
  })
}
