import { z } from 'zod'
/** Typed committed events for literature-trail behaviour tests. */
import { ToolCallId, createToolResultMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionSeq, type SessionEvent, type SessionEventMap } from '@deepseek-ai/dsh-session'
import type {
  PtcDispatchStartEventData,
  PtcDispatchEventData,
} from '@deepseek-ai/dsh-tool-executor-ptc/types'

type Position = { turn?: number; step?: number }
type Call = Omit<SessionEventMap['tool/call'], 'turn' | 'step' | 'callId'> &
  Position & { callId: string }
type Result = Omit<SessionEventMap['tool/result'], 'turn' | 'step' | 'message' | 'meta'> &
  Position & {
    meta?: unknown
    message: Pick<SessionEventMap['tool/result']['message'], 'content' | 'isError'> & {
      toolCallId: string
    }
  }
type PtcIds = { rootCallId: string; parentCallId: string; subCallId: string }
type PtcStart = Omit<PtcDispatchStartEventData, keyof PtcIds> & PtcIds
type PtcResult = Omit<PtcDispatchEventData, keyof PtcIds> & PtcIds
type Input =
  | [type: 'tool/call', data: Call]
  | [type: 'tool/result', data: Result]
  | [type: 'tool/ptc-dispatch-start', data: PtcStart]
  | [type: 'tool/ptc-dispatch', data: PtcResult]
  | [type: 'turn/start', data: SessionEventMap['turn/start']]
  | [type: 'user/message', data: { text: string }]

/** Each factory owns its monotonically increasing sequence. */
export function createEventFactory(): (...input: Input) => SessionEvent {
  let seq = 0
  return (...input): SessionEvent => {
    seq += 1
    const envelope = { seq: SessionSeq(seq), time: seq * 1000 }
    switch (input[0]) {
      case 'tool/call': {
        const data = input[1]
        return {
          ...envelope,
          type: input[0],
          data: { turn: 1, step: 1, ...data, callId: ToolCallId(data.callId) },
        }
      }
      case 'tool/result': {
        const { message, meta: rawMeta, ...data } = input[1]
        const meta = rawMeta === undefined ? undefined : z.json().parse(rawMeta)
        return {
          ...envelope,
          type: input[0],
          surfaceOp: 'append',
          data: {
            turn: 1,
            step: 1,
            ...data,
            ...(meta === undefined ? {} : { meta }),
            message: createToolResultMessage({
              callId: ToolCallId(message.toolCallId),
              content: message.content,
              isError: message.isError ?? false,
            }),
          },
        }
      }
      case 'tool/ptc-dispatch-start': {
        const data = input[1]
        return {
          ...envelope,
          type: input[0],
          data: {
            ...data,
            rootCallId: ToolCallId(data.rootCallId),
            parentCallId: ToolCallId(data.parentCallId),
            subCallId: ToolCallId(data.subCallId),
          },
        }
      }
      case 'tool/ptc-dispatch': {
        const data = input[1]
        return {
          ...envelope,
          type: input[0],
          data: {
            ...data,
            rootCallId: ToolCallId(data.rootCallId),
            parentCallId: ToolCallId(data.parentCallId),
            subCallId: ToolCallId(data.subCallId),
          },
        }
      }
      case 'turn/start':
        return { ...envelope, type: input[0], data: input[1] }
      case 'user/message':
        return {
          ...envelope,
          type: input[0],
          surfaceOp: 'append',
          data: createUserMessage({
            content: [{ type: 'text', text: input[1].text }],
            source: { kind: 'user' },
          }),
        }
    }
  }
}
