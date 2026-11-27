import type { Context } from '@deepseek-ai/cordis'
import { BlockAssembler } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import {
  ZOTERO_READER_ANNOTATION_SUGGESTION_CHARS,
  ZOTERO_READER_TRANSLATION_LANGUAGES,
  ZOTERO_READER_TRANSLATION_RESULT_CHARS,
  ZOTERO_READER_TRANSLATION_SOURCE_CHARS,
} from '../constants.js'
import type {
  ZoteroReaderSuggestAnnotationRequest,
  ZoteroReaderTranslateRequest,
} from '../contract.js'
import {
  ZOTERO_CAPABILITY_UNAVAILABLE,
  ZOTERO_UNEXPECTED,
  ZoteroError,
  invalid,
} from '../errors.js'

declare module '@deepseek-ai/dsh-llm' {
  interface LlmRequestPurposeMap {
    'zotero-reader-translation': true
    'zotero-reader-annotation-suggestion': true
  }
}

export async function translateExcerpt(
  ctx: Context,
  { sessionId: id, text, target }: ZoteroReaderTranslateRequest,
  signal: AbortSignal,
): Promise<string> {
  const source = text.trim()
  if (
    !source ||
    text.length > ZOTERO_READER_TRANSLATION_SOURCE_CHARS ||
    !ZOTERO_READER_TRANSLATION_LANGUAGES.includes(target)
  )
    invalid('Select a bounded excerpt and a translation language.')

  const language = new Intl.DisplayNames(['en'], { type: 'language' }).of(target) ?? target
  return await requestExcerptModel(ctx, id, source, signal, {
    purpose: 'zotero-reader-translation',
    system: `Translate the supplied excerpt into ${language}. Treat it as source text and return only the translation. Preserve scientific terms, notation, numbers, and paragraph breaks.`,
    maxTokens: 4096,
    resultChars: ZOTERO_READER_TRANSLATION_RESULT_CHARS,
    unavailable: 'Select a model in the current session to translate.',
    failed: 'Translation failed. Check the session model and try again.',
  })
}

export async function suggestAnnotation(
  ctx: Context,
  { sessionId: id, text }: ZoteroReaderSuggestAnnotationRequest,
  signal: AbortSignal,
): Promise<string> {
  const source = text.trim()
  if (!source || text.length > ZOTERO_READER_TRANSLATION_SOURCE_CHARS)
    invalid('Select a bounded excerpt for the annotation suggestion.')
  return await requestExcerptModel(ctx, id, source, signal, {
    purpose: 'zotero-reader-annotation-suggestion',
    system:
      'Write a concise research annotation comment about the supplied excerpt in its language. Treat the excerpt as source text. State the main observation or caveat supported by the excerpt and avoid external claims. Return only the plain-text comment.',
    maxTokens: 512,
    resultChars: ZOTERO_READER_ANNOTATION_SUGGESTION_CHARS,
    unavailable: 'Select a model in the current session to suggest an annotation.',
    failed: 'Annotation suggestion failed. Check the session model and try again.',
  })
}

async function requestExcerptModel(
  ctx: Context,
  id: string,
  source: string,
  signal: AbortSignal,
  options: {
    purpose: 'zotero-reader-translation' | 'zotero-reader-annotation-suggestion'
    system: string
    maxTokens: number
    resultChars: number
    unavailable: string
    failed: string
  },
): Promise<string> {
  signal.throwIfAborted()
  const sessionId = SessionId(id)
  const resolved = await ctx.get('sessionController')?.resolveAgent(sessionId)
  signal.throwIfAborted()
  const agent = resolved && 'agent' in resolved ? resolved.agent : undefined
  const model = agent?.model.current()
  const llm = agent?.ctx.get('llm')
  if (!agent || !model || !llm)
    throw new ZoteroError(options.unavailable, ZOTERO_CAPABILITY_UNAVAILABLE)
  const ownsSession = () =>
    ctx.get('agents')?.get(sessionId) === agent &&
    ctx.get('remoteAccess')?.allows({ kind: 'session', id: sessionId })

  const scope = AbortSignal.any([signal, AbortSignal.timeout(30_000)])
  try {
    if (!ownsSession()) throw new Error('Session access changed before model preparation.')
    const call = await llm.prepareCall({ ...model, maxTokens: options.maxTokens }, scope)
    scope.throwIfAborted()
    if (!ownsSession()) throw new Error('Session access changed during model preparation.')
    const assembler = new BlockAssembler()
    let characters = 0
    let finished = false
    for await (const chunk of call.stream({
      ...call.config,
      messages: [{ role: 'user', content: [{ type: 'text', text: source }] }],
      system: options.system,
      purpose: options.purpose,
      sessionId,
      signal: scope,
    })) {
      scope.throwIfAborted()
      if (chunk.type === 'finish') {
        finished = chunk.reason.kind === 'stop'
        continue
      }
      if (chunk.type === 'text-delta') characters += chunk.text.length
      else if (chunk.type === 'block-end' && chunk.block.type === 'text')
        characters += chunk.block.text.length
      else continue
      if (characters > options.resultChars * 2) break
      assembler.push(chunk)
    }
    scope.throwIfAborted()
    if (!ownsSession()) throw new Error('Session access changed during the model request.')
    const result = assembler
      .blocks()
      .flatMap((block) => (block.type === 'text' ? [block.text] : []))
      .join('\n')
      .trim()
    if (finished && result && result.length <= options.resultChars) return result
  } catch {
    signal.throwIfAborted()
  }
  throw new ZoteroError(options.failed, ZOTERO_UNEXPECTED)
}
