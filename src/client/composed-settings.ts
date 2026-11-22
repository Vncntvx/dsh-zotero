/**
 * One save for a settings tab that composes several namespaces. Follows the
 * harness's own `subagentCardShell` / `subagentCardFace` composition: the
 * shared shell counts only served sections, the save follows that merged state
 * and then writes each dirty section through its own revision fence, and
 * unmounting discards every draft unless a write is in flight.
 * @module dsh-zotero/client/composed-settings
 */

import type { SettingsFormShell } from '@deepseek-ai/dsh-client-ui-primitives'

/** One form a composed tab includes. */
export interface ComposedSettingsPart {
  readonly state: SettingsFormShell
  readonly save: () => void
  readonly discard: () => void
}

/** The merged shell and shared actions one tab renders. */
interface ComposedSettingsForm {
  readonly state: SettingsFormShell
  readonly save: () => void
  readonly discard: () => void
}

/**
 * Merge the forms of one tab the way the harness merges a Subagent card.
 * @param states - every form the tab includes, served or not.
 * @returns availability and settlement across the served forms.
 */
export function composedSettingsShell(states: readonly SettingsFormShell[]): SettingsFormShell {
  const sections = states.filter((state) => state.available)
  return {
    available: sections.length > 0,
    writable: sections.every((section) => section.writable),
    dirty: sections.some((section) => section.dirty),
    invalid: sections.some((section) => section.invalid),
    saving: sections.some((section) => section.saving),
    failed: sections.some((section) => section.failed),
  }
}

/**
 * Compose one tab's forms into the shared state and save/discard actions.
 * @param parts - every form the tab includes, served or not.
 * @returns the merged shell and the actions the shared form binds.
 */
export function composeSettingsForm(parts: readonly ComposedSettingsPart[]): ComposedSettingsForm {
  const state = composedSettingsShell(parts.map((part) => part.state))
  return {
    state,
    save: () => {
      if (!state.available || !state.writable || !state.dirty || state.invalid || state.saving)
        return
      for (const part of parts) {
        if (part.state.available && part.state.dirty) part.save()
      }
    },
    discard: () => {
      if (state.saving) return
      for (const part of parts) part.discard()
    },
  }
}
