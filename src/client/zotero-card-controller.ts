/**
 * The Zotero settings page's staged form over the `zotero` namespace — every
 * Config field, with the field table spelled here (the browser bundle must
 * not value-import host modules; the key set is bound to the host
 * `ResolvedConfig` at compile time below, and
 * `tests/client/zotero-card-parity.spec.ts` binds the per-field control kind
 * against the same schema at runtime, so the two surfaces cannot drift in
 * either direction).
 *
 * Staging rides the harness's own model (`SettingsFormModel` from
 * `dsh-client-ui-primitives`, the same class every first-party card stages
 * through): draft text per field, presence-based override badges, an atomic
 * revision-fenced save, and discard. The namespace form arrives as the shared
 * `ConfigForm` (`ctx.configForms.get`); a thin adapter presents it as the
 * `SettingsFormScope` the model stages over. The boolean toggle has no
 * official atom (upstream ships number/text fields only), so its spec lives
 * here in the official `SettingsFieldSpec` shape.
 *
 * One field table drives the whole card: the field specs the form edits, the
 * state the page renders, the display groups, and the numeric hint set, so a
 * field cannot silently vanish from the page or from its typed state.
 * @module dsh-zotero/client/zotero-card-controller
 */

import {
  SettingsFormModel,
  settingsNumberField,
  settingsTextField,
  type SettingsFieldSpec,
  type SettingsFieldState,
  type SettingsFormActions,
  type SettingsFormScope,
  type SettingsFormShell,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import type { ResolvedConfig } from '../config.js'

/**
 * The section fields this card edits — the host `Config` surface, all of it,
 * in display order. `group` names the page's display group (a locale key).
 * The Web toggle leads the page: it gates the whole conversation tab, so it
 * is the first thing a visitor sees. The write family sits immediately under
 * it — the sensitive surface a visitor needs before the technical limits.
 */
const FIELD_SPECS = [
  { key: 'webEnabled', kind: 'boolean', group: 'groupWeb' },
  { key: 'writeEnabled', kind: 'boolean', group: 'groupWrite' },
  { key: 'writeConfirm', kind: 'boolean', group: 'groupWrite' },
  { key: 'writePersistKey', kind: 'boolean', group: 'groupWrite' },
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
  { key: 'maxBrowseResults', kind: 'number', group: 'groupOutput' },
  { key: 'maxChangesResults', kind: 'number', group: 'groupOutput' },
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

/**
 * A boolean field: the draft is the literal 'true'/'false' text a toggle
 * control maps to a checked state. An empty draft clears the field.
 * @param field - field name inside the settings section.
 * @returns the field's conversion spec in the official shape.
 */
function booleanFieldSpec(field: string): SettingsFieldSpec {
  return {
    field,
    format: (value) => (typeof value === 'boolean' ? String(value) : ''),
    parse: (text) => {
      const trimmed = text.trim()
      if (trimmed === '') return { kind: 'clear' }
      if (trimmed === 'true') return { kind: 'set', value: true }
      if (trimmed === 'false') return { kind: 'set', value: false }
      return undefined
    },
  }
}

/** Field specs built on first use: the official helpers resolve through the loader's module table, which only exists at factory-execution time (the bundle self-check stubs externals at import, so module-level calls would fail there). */
function fieldSpecs(): SettingsFieldSpec[] {
  return FIELD_SPECS.map((spec) => {
    if (spec.kind === 'number') return settingsNumberField(spec.key)
    if (spec.kind === 'boolean') return booleanFieldSpec(spec.key)
    return settingsTextField(spec.key)
  })
}

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
export type ZoteroCardState = SettingsFormShell & { readonly [K in FieldKey]: SettingsFieldState }

/** The registration-side face the card's slot entry injects. */
export interface ZoteroCardFace extends SettingsFormActions {
  hooks: {
    /** Card snapshot bound by the renderer as useZoteroCard. */
    zoteroCard: SnapshotStore<ZoteroCardState>
  }
}

/**
 * Present the shared namespace form as the scope the staged model edits.
 * The snapshots differ by one field (`mode`, a client transport fact the
 * model never reads); the write edge is the same atomic revision-fenced
 * mutation, with the path/value shapes narrowed to the JSON the wire takes.
 * @param form - the shared form for the `zotero` namespace.
 * @returns the scope the model stages over.
 */
function asFormScope(
  form: ConfigForm<Record<string, unknown>>,
): SettingsFormScope<Record<string, unknown>> {
  return {
    getSnapshot: () => {
      const { mode: _mode, ...snapshot } = form.getSnapshot()
      return snapshot
    },
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

/** Bridges the `zotero` form onto the page's staged model. */
export class ZoteroCardController {
  private readonly form: SettingsFormModel<Record<string, unknown>>
  private readonly store: SnapshotStore<ZoteroCardState>

  /**
   * @param form - the shared configuration form for the `zotero` namespace.
   */
  constructor(form: ConfigForm<Record<string, unknown>>) {
    this.form = new SettingsFormModel(asFormScope(form), fieldSpecs())
    this.store = this.form.bind(() => this.projection())
  }

  private projection(): ZoteroCardState {
    const fields = Object.fromEntries(
      FIELD_SPECS.map((spec) => [spec.key, this.form.field(spec.key)]),
    ) as { [K in FieldKey]: SettingsFieldState }
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

  /** Release the form's namespace subscription. */
  dispose(): void {
    this.form.dispose()
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
