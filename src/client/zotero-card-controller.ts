/**
 * The Zotero settings page's staged form over the `zotero` settings
 * namespace — every Config field, mirroring the host schema in `src/config.ts`
 * (spelled here rather than value-imported: the browser bundle must not pull
 * host modules in; the key set is bound to the host `ResolvedConfig` at
 * compile time below, so the two surfaces cannot drift). The scope arrives
 * through the shared `SettingsScope` contract, so the form is indifferent to
 * whether the harness's settings RPC or the plugin's own Typert Remote
 * endpoints back it.
 *
 * One field table drives the whole card: the field specs the form edits, the
 * state the page renders, the display groups, and the numeric hint set, so a
 * field cannot silently vanish from the page or from its typed state.
 * @module dsh-zotero/client/zotero-card-controller
 */

import type { SettingsScope, SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { ResolvedConfig } from '../config.js'
import {
  CardForm,
  booleanField,
  numberField,
  textField,
  type CardActions,
  type CardFieldSpec,
  type CardFieldState,
  type CardShell,
} from './card-form.ts'

/**
 * The section fields this card edits — the host `Config` surface, all of it,
 * in display order. `group` names the page's display group (a locale key).
 * The Web toggle leads the page: it gates the whole conversation tab, so it
 * is the first thing a visitor sees.
 */
const FIELD_SPECS = [
  { key: 'webEnabled', kind: 'boolean', group: 'groupWeb' },
  { key: 'baseUrl', kind: 'text', group: 'groupConnection' },
  { key: 'provider', kind: 'text', group: 'groupConnection' },
  { key: 'timeoutMs', kind: 'number', group: 'groupConnection' },
  { key: 'maxSearchResults', kind: 'number', group: 'groupSearch' },
  { key: 'maxNoteScanRecords', kind: 'number', group: 'groupSearch' },
  { key: 'maxEvidenceChars', kind: 'number', group: 'groupSearch' },
  { key: 'maxEvidencePassages', kind: 'number', group: 'groupSearch' },
  { key: 'maxDetailChars', kind: 'number', group: 'groupSearch' },
  { key: 'maxNoteBodyChars', kind: 'number', group: 'groupSearch' },
  { key: 'maxNoteChars', kind: 'number', group: 'groupSearch' },
  { key: 'maxNoteRecords', kind: 'number', group: 'groupSearch' },
  { key: 'maxAnnotationRecords', kind: 'number', group: 'groupSearch' },
  { key: 'fulltextChunkWords', kind: 'number', group: 'groupSearch' },
  { key: 'maxFulltextChars', kind: 'number', group: 'groupSearch' },
  { key: 'maxResponseBytes', kind: 'number', group: 'groupOutput' },
  { key: 'maxExportChars', kind: 'number', group: 'groupOutput' },
  { key: 'maxExportRefs', kind: 'number', group: 'groupOutput' },
  { key: 'defaultStyle', kind: 'text', group: 'groupDefaults' },
  { key: 'defaultLocale', kind: 'text', group: 'groupDefaults' },
] as const satisfies readonly {
  key: keyof ResolvedConfig
  kind: 'text' | 'number' | 'boolean'
  group: string
}[]

/** The section field names the card edits; also the page's copy and state member names. */
export type FieldKey = (typeof FIELD_SPECS)[number]['key']
/** The display group a field belongs to; a page locale key. */
export type GroupKey = (typeof FIELD_SPECS)[number]['group']

/** Host Config fields the card does not list; a non-empty union fails the client build. */
type MissingConfigField = Exclude<keyof ResolvedConfig, FieldKey>
// The assignment check exists only for its type: a missing host field makes
// `_configSurfaceComplete` `never`, so `true` stops being assignable.
const _configSurfaceComplete: MissingConfigField extends never ? true : never = true

const FIELDS: CardFieldSpec[] = FIELD_SPECS.map((spec) => {
  if (spec.kind === 'number') return numberField(spec.key)
  if (spec.kind === 'boolean') return booleanField(spec.key)
  return textField(spec.key)
})

/** The page's field keys grouped by the host schema's families, in display order. */
export const FIELD_GROUPS: readonly {
  readonly key: GroupKey
  readonly fields: readonly FieldKey[]
}[] = groupFields(FIELD_SPECS)

/** The whole-number fields, rendered with a numeric keypad hint. */
export const NUMERIC_FIELD_KEYS: ReadonlySet<FieldKey> = new Set<FieldKey>(
  FIELD_SPECS.filter((spec) => spec.kind === 'number').map((spec) => spec.key),
)

/** The boolean fields, rendered as toggles. */
export const BOOLEAN_FIELD_KEYS: ReadonlySet<FieldKey> = new Set<FieldKey>(
  FIELD_SPECS.filter((spec) => spec.kind === 'boolean').map((spec) => spec.key),
)

/** What the Zotero page renders: the shell plus one control per field. */
export type ZoteroCardState = CardShell & { readonly [K in FieldKey]: CardFieldState }

/** The registration-side face the card's slot entry injects. */
export interface ZoteroCardFace extends CardActions {
  hooks: {
    /** Card snapshot bound by the renderer as useZoteroCard. */
    zoteroCard: SnapshotStore<ZoteroCardState>
  }
}

/** Bridges the `zotero` scope onto the page's staged form. */
export class ZoteroCardController {
  private readonly form: CardForm
  private readonly store: SnapshotStore<ZoteroCardState>

  /**
   * @param scope - the bound settings scope for the `zotero` namespace. The
   *   seam types the section generically; the settings wire validates it
   *   against the host Config schema, so reading it as a plain object record
   *   is the contract the host registration established.
   */
  constructor(scope: SettingsScope<unknown>) {
    this.form = new CardForm(scope as SettingsScope<Record<string, unknown>>, FIELDS)
    this.store = this.form.bind(() => this.projection())
  }

  private projection(): ZoteroCardState {
    const fields = Object.fromEntries(
      FIELD_SPECS.map((spec) => [spec.key, this.form.field(spec.key)]),
    ) as { [K in FieldKey]: CardFieldState }
    return {
      ...this.form.shell(),
      ...fields,
    }
  }

  /**
   * Build the face the card's slot registration injects.
   * @returns the card's snapshot and its form actions.
   */
  inject(): ZoteroCardFace {
    return { hooks: { zoteroCard: this.store }, ...this.form.actions() }
  }
}

/** Group the ordered field specs into display groups, preserving declaration order. */
function groupFields(
  specs: typeof FIELD_SPECS,
): readonly { readonly key: GroupKey; readonly fields: readonly FieldKey[] }[] {
  const groups: { key: GroupKey; fields: FieldKey[] }[] = []
  for (const spec of specs) {
    const last = groups[groups.length - 1]
    if (last !== undefined && last.key === spec.group) last.fields.push(spec.key)
    else groups.push({ key: spec.group, fields: [spec.key] })
  }
  return groups
}
