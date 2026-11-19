/**
 * The Zotero settings page's staged form over the `zotero` namespace: connection, capability and runtime
 * fields (CSL defaults use CitationFormController), with the field table spelled here. The browser bundle cannot
 * value-import host modules, so the key set is pinned to the host
 * `ResolvedConfig` at compile time below; `tests/client/cards/zotero-card-parity.spec.ts`
 * checks the per-field control kind against the same schema at runtime, so the
 * two surfaces cannot drift in either direction.
 *
 * Staging rides the harness's own model (`SettingsFormModel` from
 * `dsh-client-ui-primitives`, the same class every first-party card stages
 * through): draft text per field, presence-based override badges, an atomic
 * revision-fenced save, and discard. The namespace form arrives as the shared
 * `ConfigForm` (`ctx.configForms.get`); a thin adapter presents it as the
 * `SettingsFormScope` the model stages over. Upstream ships number and text
 * fields only, so the boolean toggle's spec lives here in the official
 * `SettingsFieldSpec` shape.
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
  type SettingsFormShell,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { ResolvedConfig } from '../config.ts'
import { asFormScope } from './helpers/form-scope.ts'
import { booleanFieldSpec } from './helpers/settings-fields.ts'
import type { CitationFieldKey } from './citation-form-controller.ts'

/** The visible display groups; each is a locale key. */
export type GroupKey =
  | 'groupWeb'
  | 'groupWrite'
  | 'groupConnection'
  | 'groupSearchQuery'
  | 'groupSearchEvidence'
  | 'groupJobs'
  | 'groupDiagnostics'

type FieldKind = 'text' | 'number' | 'boolean'

interface VisibleFieldSpec {
  readonly key: keyof ResolvedConfig
  readonly kind: FieldKind
  readonly group: GroupKey
  readonly hidden?: false
}

interface HiddenFieldSpec {
  readonly key: keyof ResolvedConfig
  readonly kind: FieldKind
  readonly hidden: true
}

type FieldSpec = VisibleFieldSpec | HiddenFieldSpec

/**
 * The namespace fields this card models: the host `Config` surface except the two CSL defaults.
 * Visible specs carry a display group and render; hidden specs stay in the schema and the
 * profile config file, and are projected into state so the form can still stage them.
 * The Web toggle leads the visible page because it gates the whole conversation tab,
 * so a visitor sees it first. The write family sits under it: the sensitive
 * surface a visitor should see before the technical limits.
 */
const FIELD_SPECS = [
  { key: 'webEnabled', kind: 'boolean', group: 'groupWeb', hidden: false },
  { key: 'writeEnabled', kind: 'boolean', group: 'groupWrite', hidden: false },
  { key: 'writePersistKey', kind: 'boolean', group: 'groupWrite', hidden: false },
  { key: 'baseUrl', kind: 'text', group: 'groupConnection', hidden: false },
  { key: 'timeoutMs', kind: 'number', group: 'groupConnection', hidden: false },
  { key: 'maxSearchResults', kind: 'number', group: 'groupSearchQuery', hidden: false },
  { key: 'maxBrowseResults', kind: 'number', group: 'groupSearchQuery', hidden: false },
  { key: 'maxEvidenceChars', kind: 'number', group: 'groupSearchEvidence', hidden: false },
  { key: 'maxEvidencePassages', kind: 'number', group: 'groupSearchEvidence', hidden: false },
  { key: 'maxFulltextChars', kind: 'number', group: 'groupSearchEvidence', hidden: false },
  { key: 'enableRunInBackground', kind: 'boolean', group: 'groupJobs', hidden: false },
  { key: 'promoteOnTimeout', kind: 'boolean', group: 'groupJobs', hidden: false },
  { key: 'debug', kind: 'boolean', group: 'groupDiagnostics', hidden: false },
  { key: 'writeNoteMaxChars', kind: 'number', hidden: true },
  { key: 'writeFieldMaxChars', kind: 'number', hidden: true },
  { key: 'writeListMaxItems', kind: 'number', hidden: true },
  { key: 'writeAuthorizeDeadlineMs', kind: 'number', hidden: true },
  { key: 'provider', kind: 'text', hidden: true },
  { key: 'maxInFlightRequests', kind: 'number', hidden: true },
  { key: 'scopeListingTtlMs', kind: 'number', hidden: true },
  { key: 'maxNoteScanRecords', kind: 'number', hidden: true },
  { key: 'searchConcurrency', kind: 'number', hidden: true },
  { key: 'graphConcurrency', kind: 'number', hidden: true },
  { key: 'retrieveAttachmentCap', kind: 'number', hidden: true },
  { key: 'maxNoteChars', kind: 'number', hidden: true },
  { key: 'maxNoteRecords', kind: 'number', hidden: true },
  { key: 'maxAnnotationRecords', kind: 'number', hidden: true },
  { key: 'maxAttachmentRecords', kind: 'number', hidden: true },
  { key: 'fulltextChunkWords', kind: 'number', hidden: true },
  { key: 'fulltextWindowChars', kind: 'number', hidden: true },
  { key: 'maxInlineResultTokens', kind: 'number', hidden: true },
  { key: 'maxInlineResultBytes', kind: 'number', hidden: true },
  { key: 'maxResponseBytes', kind: 'number', hidden: true },
  { key: 'maxExportChars', kind: 'number', hidden: true },
  { key: 'maxExportRefs', kind: 'number', hidden: true },
  { key: 'maxChangesResults', kind: 'number', hidden: true },
  { key: 'foregroundWaitMs', kind: 'number', hidden: true },
] as const satisfies readonly FieldSpec[]

/** The namespace field names the card models; also the page's copy and state member names. */
export type FieldKey = (typeof FIELD_SPECS)[number]['key']

/** The field names the page renders: those whose spec carries a display group. */
export type VisibleFieldKey = Extract<
  (typeof FIELD_SPECS)[number],
  { readonly hidden?: false }
>['key']

/** Host Config fields the card does not list; a non-empty union fails the client build. */
type MissingConfigField = Exclude<keyof ResolvedConfig, FieldKey | CitationFieldKey>
type AssertNever<T extends never> = T
/** Compile-time exhaustiveness pin (unexported declare). */
declare const _configSurfaceComplete: AssertNever<MissingConfigField>

/**
 * Field specs, built on first use. The official helpers resolve through the
 * loader's module table, which only exists once the factory runs: the bundle
 * self-check stubs externals at import, so module-level calls would fail there.
 */
function fieldSpecs(): SettingsFieldSpec[] {
  return FIELD_SPECS.map((spec) => {
    if (spec.kind === 'number') return settingsNumberField(spec.key)
    if (spec.kind === 'boolean') return booleanFieldSpec(spec.key)
    return settingsTextField(spec.key)
  })
}

/** Every namespace field the card models, including the ones the page does not render. */
export const ALL_FIELD_KEYS: readonly FieldKey[] = FIELD_SPECS.map((spec) => spec.key)

/** The fields the page renders, in display order. */
export const VISIBLE_FIELD_KEYS: readonly FieldKey[] = FIELD_SPECS.filter(
  (spec) => !spec.hidden,
).map((spec) => spec.key)

/** The fields that exist only in the schema and the profile config file. */
export const HIDDEN_FIELD_KEYS: readonly FieldKey[] = FIELD_SPECS.filter((spec) => spec.hidden).map(
  (spec) => spec.key,
)

/** The page's visible field keys grouped by the host schema's families, in display order. */
export const FIELD_GROUPS: readonly {
  readonly key: GroupKey
  readonly fields: readonly VisibleFieldKey[]
}[] = groupFields(FIELD_SPECS)

/** The whole-number fields, rendered with a numeric keypad hint. */
export const NUMERIC_FIELD_KEYS: ReadonlySet<FieldKey> = new Set<FieldKey>(
  FIELD_SPECS.filter((spec) => spec.kind === 'number').map((spec) => spec.key),
)

/** The component-level tab identifiers for the 4-tab settings view. */
export type SettingsTabId = 'general' | 'library' | 'scholarly' | 'enrichment'

/** Description of one tab partition. */
interface SettingsTabDescriptor {
  readonly id: SettingsTabId
  readonly labelKey: 'tabGeneral' | 'tabSettingsLibrary' | 'tabScholarly' | 'tabEnrichment'
}

/**
 * The four tab partitions, in display order: one per component. The general tab
 * carries every core configuration group; the other three are managed by their
 * own form controllers.
 */
export const SETTINGS_TABS: readonly SettingsTabDescriptor[] = [
  { id: 'general', labelKey: 'tabGeneral' },
  { id: 'library', labelKey: 'tabSettingsLibrary' },
  { id: 'scholarly', labelKey: 'tabScholarly' },
  { id: 'enrichment', labelKey: 'tabEnrichment' },
] as const

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

/** Group the visible field specs into display groups, preserving declaration order. */
function groupFields(
  specs: readonly (typeof FIELD_SPECS)[number][],
): readonly { readonly key: GroupKey; readonly fields: readonly VisibleFieldKey[] }[] {
  const groups: { key: GroupKey; fields: VisibleFieldKey[] }[] = []
  for (const spec of specs) {
    if (spec.hidden) continue
    const last = groups[groups.length - 1]
    if (last !== undefined && last.key === spec.group) last.fields.push(spec.key)
    else groups.push({ key: spec.group, fields: [spec.key] })
  }
  return groups
}
