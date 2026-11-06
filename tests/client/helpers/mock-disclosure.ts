/**
 * Shared mock UseDisclosure helper and typed tool props factory for toolview specs.
 * @module tests/client/helpers/mock-disclosure
 */

import { vi } from 'vitest'
import type { UseDisclosure } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { ToolCallPhaseProps } from '@deepseek-ai/dsh-client-ui-tool/client'
import type { ZoteroClientFace } from '../../../src/client/actions/client-face.ts'
import { mockT } from './mock-translate.ts'
import { zoteroClientStub } from './zotero-client.ts'

export function mockUseDisclosure(expanded = true): UseDisclosure {
  return () => ({
    expanded,
    toggle: vi.fn(),
    expand: vi.fn(),
    collapse: vi.fn(),
    setExpanded: vi.fn(),
  })
}

export type MockToolViewProps<TToolName extends string> = PropsRuntime<
  'tool.call.toolview',
  TToolName
> &
  PropsLocale<'zotero'>

export function createToolViewProps<TToolName extends string>(props: {
  readonly toolName: TToolName
  readonly block: ToolCallPhaseProps['block']
  readonly phase?: 'preparing' | 'start' | 'result'
  readonly useDisclosure?: UseDisclosure
  readonly inspect?: () => void
  readonly callId?: string
  readonly t?: typeof mockT
  readonly useZoteroClient?: () => ZoteroClientFace
}): MockToolViewProps<TToolName> {
  return {
    callId: props.callId ?? 'c1',
    toolName: props.toolName,
    phase: props.phase ?? 'result',
    block: props.block,
    useDisclosure: props.useDisclosure ?? mockUseDisclosure(true),
    t: props.t ?? mockT,
    openFile: vi.fn(),
    loadImage: vi.fn(),
    inspect: props.inspect,
    useZoteroClient: props.useZoteroClient ?? (() => zoteroClientStub()),
  } as unknown as MockToolViewProps<TToolName>
}
