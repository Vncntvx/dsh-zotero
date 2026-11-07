/**
 * The model-facing parameter correction hint.
 *
 * A rejected call already names the missing required property; what the
 * pipeline cannot know is which misspelled argument the model sent instead.
 * This module pairs the two names and appends one hint block to the error
 * result. It runs as a `tools/post-execute` listener so every plugin tool —
 * core read, core write, and scholarly — gets the same treatment without
 * wrapping fifteen independent registrations.
 *
 * The hint never changes the error code, issues a request, or retries. It is
 * emitted only for a unique close match; a wrong suggestion would cost the
 * retry the hint exists to save.
 *
 * @module dsh-zotero/parameter-correction
 */

import type { Context } from '@deepseek-ai/cordis'
import type {
  PostToolDecision,
  ToolDefinition,
  ToolExecution,
  ToolExecutionResult,
} from '@deepseek-ai/dsh-tools'
import { asRecord } from './json.js'

/**
 * The harness error code `ToolArgsError` stamps on a schema-violating call
 * (`@deepseek-ai/dsh-tools`, packages/core/tools/src/schema.ts). Anchored once
 * so a harness rename surfaces here instead of silently disabling the hint.
 */
const INVALID_ARGS_CODE = 'INVALID_ARGS'

/** One undeclared argument and the declared parameter it was meant for. */
export interface ParameterCorrection {
  readonly input: string
  readonly expected: string
}

/** Resolve the definition a call executed, for its parameter schema. */
export type ParameterCorrectionLookup = (exec: ToolExecution) => ToolDefinition | undefined

/** The shape of one `tools/post-execute` listener. */
export type ParameterCorrectionListener = (
  exec: ToolExecution,
  result: Readonly<ToolExecutionResult>,
  next: () => Promise<PostToolDecision>,
) => Promise<PostToolDecision>

/** Normalize a parameter name for comparison. */
function normalizeParameterName(name: string): string {
  return name.normalize('NFKC').toLowerCase().replace(/[_-]/g, '')
}

/**
 * Damerau-Levenshtein edit distance under optimal string alignment: insertion,
 * deletion, substitution, and an adjacent transposition each cost one. A
 * transposition is a common model typo (`fromat` for `format`), so it must not
 * count as two edits and fall outside the tolerance.
 */
function editDistance(left: string, right: string): number {
  const rows = left.length + 1
  const columns = right.length + 1
  const distances: number[][] = Array.from({ length: rows }, (_, row) =>
    Array.from({ length: columns }, (_, column) => (row === 0 ? column : column === 0 ? row : 0)),
  )
  for (let leftIndex = 1; leftIndex < rows; leftIndex++) {
    for (let rightIndex = 1; rightIndex < columns; rightIndex++) {
      const substitution = left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1
      distances[leftIndex]![rightIndex] = Math.min(
        distances[leftIndex - 1]![rightIndex]! + 1,
        distances[leftIndex]![rightIndex - 1]! + 1,
        distances[leftIndex - 1]![rightIndex - 1]! + substitution,
      )
      if (
        leftIndex > 1 &&
        rightIndex > 1 &&
        left[leftIndex - 1] === right[rightIndex - 2] &&
        left[leftIndex - 2] === right[rightIndex - 1]
      ) {
        distances[leftIndex]![rightIndex] = Math.min(
          distances[leftIndex]![rightIndex]!,
          distances[leftIndex - 2]![rightIndex - 2]! + 1,
        )
      }
    }
  }
  return distances[left.length]![right.length]!
}

/**
 * The edit distance a name of this length may carry and still be read as the
 * same word: names of five characters or fewer allow one edit; longer names
 * allow at most two, and never more than a fifth of the name.
 */
function distanceTolerance(length: number): number {
  return length <= 5 ? 1 : Math.min(2, Math.floor(length * 0.2))
}

/**
 * The one declared name an undeclared argument could be a misspelling of.
 * @param input - the argument name the model sent.
 * @param candidates - the required declared names the call is missing.
 * @returns the closest declared name, or undefined when none is close or two
 * are equally close.
 */
function closestParameterName(input: string, candidates: readonly string[]): string | undefined {
  const normalized = normalizeParameterName(input)
  if (!normalized) return undefined
  const matches = candidates
    .map((candidate) => {
      const normalizedCandidate = normalizeParameterName(candidate)
      return {
        candidate,
        distance: editDistance(normalized, normalizedCandidate),
        tolerance: distanceTolerance(Math.max(normalized.length, normalizedCandidate.length)),
      }
    })
    .filter(({ distance, tolerance }) => distance <= tolerance)
    .sort((left, right) => left.distance - right.distance)
  if (matches.length === 0 || matches[1]?.distance === matches[0]?.distance) return undefined
  return matches[0]!.candidate
}

/**
 * Pair one undeclared argument with the missing required parameter it
 * misspells. Ambiguity yields no hint: a wrong suggestion costs the model the
 * retry the hint exists to save.
 * @param parameters - the tool's declared parameter schema.
 * @param argumentsValue - the arguments the model sent.
 * @param result - the normalized outcome.
 * @returns the correction, or undefined when there is nothing to correct.
 */
export function parameterCorrectionOf(
  parameters: ToolDefinition['parameters'] | undefined,
  argumentsValue: unknown,
  result: Readonly<ToolExecutionResult>,
): ParameterCorrection | undefined {
  if (!result.isError || result.error.info?.code !== INVALID_ARGS_CODE) return undefined
  const args = asRecord(argumentsValue)
  const schema = asRecord(parameters)
  const properties = asRecord(schema?.properties)
  if (!args || !properties || !Array.isArray(schema?.required)) return undefined

  const missingRequired = schema.required.filter(
    (name): name is string =>
      typeof name === 'string' && !Object.hasOwn(args, name) && Object.hasOwn(properties, name),
  )
  if (missingRequired.length === 0) return undefined

  let correction: ParameterCorrection | undefined
  for (const input of Object.keys(args)) {
    if (Object.hasOwn(properties, input)) continue
    const expected = closestParameterName(input, missingRequired)
    if (expected === undefined) continue
    if (correction !== undefined) return undefined
    correction = { input, expected }
  }
  return correction
}

/**
 * The model-facing correction block. The error it accompanies already names
 * the missing property; the hint supplies the argument the model sent instead.
 * @param tool - the tool that rejected the call.
 * @param correction - the rejected argument and the declared parameter.
 * @returns the content block text appended to the error result.
 */
export function parameterCorrectionHint(tool: string, correction: ParameterCorrection): string {
  return `\n[Zotero parameter correction] "${correction.input}" is not a declared parameter of ${tool}. Did you mean "${correction.expected}"? Retry with the declared parameter name.`
}

/**
 * Build the `tools/post-execute` listener for one tool-name set. It appends
 * after `next()` so a downstream content replacement is preserved, and leaves
 * a block decision untouched.
 * @param admitted - the tool names this installer owns.
 * @param lookup - resolves the executed definition for its parameter schema.
 * @returns the waterfall listener.
 */
export function parameterCorrectionListener(
  admitted: ReadonlySet<string>,
  lookup: ParameterCorrectionLookup,
): ParameterCorrectionListener {
  return async (exec, result, next) => {
    if (
      !admitted.has(exec.name) ||
      !result.isError ||
      result.error.info?.code !== INVALID_ARGS_CODE
    )
      return next()
    const decision = await next()
    if (decision.kind !== 'accept' || Object.hasOwn(decision, 'value')) return decision
    const definition = lookup(exec)
    const correction = parameterCorrectionOf(definition?.parameters, exec.arguments, result)
    if (correction === undefined) return decision
    return {
      kind: 'accept',
      content: [
        ...(decision.content ?? result.content),
        { type: 'text', text: parameterCorrectionHint(exec.name, correction) },
      ],
      ...(decision.additionalContexts === undefined
        ? {}
        : { additionalContexts: decision.additionalContexts }),
    }
  }
}

/**
 * Install the correction listener for the given tool names. The listener is
 * fiber-scoped, so it unwinds with the installing service.
 * @param ctx - the plugin context carrying the tool registry.
 * @param names - the tool names this installer owns.
 */
export function installParameterCorrection(ctx: Context, names: readonly string[]): void {
  const admitted = new Set(names)
  ctx.on(
    'tools/post-execute',
    parameterCorrectionListener(admitted, (exec) =>
      ctx.tools.get(exec.name, exec.agent, exec.toolSet),
    ),
  )
}
