/**
 * Adapter that presents a client ConfigForm as a SettingsFormScope.
 *
 * Both the Zotero and the Scholarly staged model go through this conversion to
 * make revision-fenced atomic mutations against the shared form model.
 * @module dsh-zotero/client/helpers/form-scope
 */

import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { SettingsFormScope } from '@deepseek-ai/dsh-client-ui-primitives'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'

/**
 * Present a shared namespace form as the scope a staged SettingsFormModel edits.
 * @param form - the shared ConfigForm instance.
 * @returns the scope the model stages over.
 */
export function asFormScope(
  form: ConfigForm<Record<string, unknown>>,
): SettingsFormScope<Record<string, unknown>> {
  return {
    getSnapshot: () => form.getSnapshot(),
    subscribe: (listener) => form.subscribe(listener),
    mutate: (ops, expectedRevision) =>
      form.mutate(
        ops.map((op) =>
          op.op === 'set'
            ? { op: 'set' as const, path: [...op.path], value: op.value as JsonValue }
            : { op: 'unset' as const, path: [...op.path] },
        ),
        expectedRevision,
      ),
  }
}
