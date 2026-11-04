/**
 * One step admission built over real definitions.
 *
 * Specs about tool-aware prompt sections need the same contract the executor
 * gives them: `ResolvedToolSet.view` resolves definitions only for the agent
 * the set was captured for and reports nothing for any other scope. Modelling
 * that here keeps a spec from asserting trimming that no assembly can produce,
 * and lets the scope-missing fallback be exercised directly.
 * @module tests/helpers/tool-set
 */

import type { ResolvedToolSet, ToolDefinition } from '@deepseek-ai/dsh-tools'

/**
 * Build a step admission over the given definitions.
 * @param agent - the agent scope the step was captured for.
 * @param definitions - the definitions the step admits.
 * @returns the admission, honouring the same scope rule as the registry.
 */
export function admittedToolSet(
  agent: object,
  definitions: readonly ToolDefinition[],
): ResolvedToolSet {
  const admitted = new Map(definitions.map((definition) => [definition.name, definition]))
  return {
    dispose() {},
    view: (scope) =>
      scope === agent
        ? new Map<string, ToolDefinition>(admitted)
        : new Map<string, ToolDefinition>(),
  }
}
