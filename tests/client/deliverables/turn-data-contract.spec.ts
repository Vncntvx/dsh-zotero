/**
 * The `deliverables` turn-data contract between the local augmentation, the
 * typed projection fixture, and the production reader. A shape drift on any
 * side fails typecheck here rather than silently producing a green suite that
 * reads a value the engine would never publish.
 * @module tests/client/deliverables/turn-data-contract
 */

import { expect, expectTypeOf, it } from 'vitest'
import type { ChatSnapshot } from '@deepseek-ai/dsh-client-ui-chat/client'
import type {
  ConversationTurnDataMap,
  TurnLocation,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { PresentedFile } from '@deepseek-ai/dsh-tool-present/types'
import type { DeliverableFileMeta } from '../../../src/client/bibliography.ts'
import { resolveDeliverableFile } from '../../../src/client/components/deliverables/DeliverableZoteroAction.tsx'
import { turnProjection } from './support/turn-projection.ts'

type DeliverablesTurnData = ConversationTurnDataMap['deliverables']
type PresentedPath = NonNullable<DeliverablesTurnData['presented']>[number]

it('declares one deliverables key whose value the production reader accepts', () => {
  expectTypeOf<'deliverables'>().toMatchTypeOf<keyof ConversationTurnDataMap>()
  expectTypeOf<DeliverablesTurnData['produced']>().toEqualTypeOf<
    readonly { readonly path: string; readonly argumentPath?: string }[]
  >()
  expectTypeOf<DeliverablesTurnData['changes']>().toEqualTypeOf<
    { readonly seq: number } | undefined
  >()
  expectTypeOf<PresentedPath>().toMatchTypeOf<PresentedFile>()
  expectTypeOf<PresentedPath>().toMatchTypeOf<{ readonly seq: number; readonly index: number }>()
  expectTypeOf<PresentedPath['path']>().toEqualTypeOf<DeliverableFileMeta['path']>()
  expectTypeOf<PresentedPath['description']>().toEqualTypeOf<DeliverableFileMeta['description']>()

  const state: ChatSnapshot = turnProjection([
    { type: 'turn/start', seq: 1, turn: 1 },
    {
      type: 'deliverables/presented',
      seq: 4,
      turn: 1,
      files: [{ path: '/workspace/papers.bib', description: 'exported BibTeX' }],
    },
  ]).snapshot()
  const turn = state.timeline.turns.get(1)
  expectTypeOf(turn).toEqualTypeOf<TurnLocation | undefined>()
  const data = turn?.data.get('deliverables')
  expectTypeOf(data).toEqualTypeOf<Readonly<DeliverablesTurnData> | undefined>()
  expect(state.timeline.turnOrder).toEqual([1])
  expect(turn?.status).toBe('open')
  expect(data?.produced).toEqual([])
  expect(data?.presented).toEqual([
    { path: '/workspace/papers.bib', description: 'exported BibTeX', seq: 4, index: 0 },
  ])
  expectTypeOf(resolveDeliverableFile('seq=4&index=0', state)).toEqualTypeOf<
    DeliverableFileMeta | undefined
  >()
  expect(resolveDeliverableFile('seq=4&index=0', state)).toMatchObject({
    path: '/workspace/papers.bib',
    description: 'exported BibTeX',
  })
})

it('keeps a late delivery on its owning turn after that turn closes', () => {
  const projection = turnProjection([
    { type: 'turn/start', seq: 1, turn: 1 },
    { type: 'turn/end', seq: 2, turn: 1 },
    { type: 'turn/start', seq: 3, turn: 2 },
  ])
  const before = projection.snapshot()
  let notified = 0
  const unsubscribe = projection.subscribe(() => {
    notified += 1
  })

  projection.append({
    type: 'deliverables/presented',
    seq: 4,
    turn: 1,
    files: [{ path: '/workspace/late.bib' }],
  })
  const after = projection.flush()

  expect(notified).toBe(1)
  expect(after).not.toBe(before)
  expect(before.timeline.turns.get(1)?.data.get('deliverables')?.presented).toBeUndefined()
  expect(after.timeline.turnOrder).toEqual([1, 2])
  expect(after.timeline.turns.get(1)?.status).toBe('closed')
  expect(after.timeline.turns.get(1)?.data.get('deliverables')?.presented).toEqual([
    { path: '/workspace/late.bib', seq: 4, index: 0 },
  ])
  expect(resolveDeliverableFile('seq=4&index=0', after)).toMatchObject({
    path: '/workspace/late.bib',
  })

  unsubscribe()
  projection.flush()
  expect(notified).toBe(1)
})
