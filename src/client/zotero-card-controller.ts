/**
 * The Zotero settings page's staged form over the `zotero` settings
 * namespace — every Config field, mirroring the host schema in `src/config.ts`
 * (spelled here rather than imported: the browser bundle must not pull host
 * modules in). The scope arrives through the shared `SettingsScope` contract,
 * so the form is indifferent to whether the harness's settings RPC or the
 * plugin's own Typert Remote endpoints back it.
 * @module dsh-zotero/client/zotero-card-controller
 */

import type { SettingsScope } from '@deepseek-ai/dsh-client-runtime/client'
import { ZOTERO_SETTINGS_NAMESPACE } from '../settings-namespace.ts'
import {
  CardForm,
  numberField,
  textField,
  type CardActions,
  type CardFieldSpec,
  type CardFieldState,
  type CardShell,
} from './card-form.ts'
import type { SnapshotSource } from './snapshot.ts'

/** The section fields this card edits — the host `Config` surface, all of it. */
const FIELDS: CardFieldSpec[] = [
  textField('baseUrl'),
  textField('provider'),
  numberField('timeoutMs'),
  numberField('maxSearchResults'),
  numberField('maxNoteScanRecords'),
  numberField('maxEvidenceChars'),
  numberField('maxEvidencePassages'),
  numberField('maxDetailChars'),
  numberField('maxNoteBodyChars'),
  numberField('maxNoteChars'),
  numberField('maxNoteRecords'),
  numberField('maxAnnotationRecords'),
  numberField('fulltextChunkWords'),
  numberField('maxFulltextChars'),
  numberField('maxResponseBytes'),
  numberField('maxExportChars'),
  numberField('maxExportRefs'),
  textField('defaultStyle'),
  textField('defaultLocale'),
]

/** What the Zotero page renders: the shell plus one control per field. */
export interface ZoteroCardState extends CardShell {
  /** True while the first namespace read is still crossing the wire. */
  loading: boolean
  baseUrl: CardFieldState
  provider: CardFieldState
  timeoutMs: CardFieldState
  maxSearchResults: CardFieldState
  maxNoteScanRecords: CardFieldState
  maxEvidenceChars: CardFieldState
  maxEvidencePassages: CardFieldState
  maxDetailChars: CardFieldState
  maxNoteBodyChars: CardFieldState
  maxNoteChars: CardFieldState
  maxNoteRecords: CardFieldState
  maxAnnotationRecords: CardFieldState
  fulltextChunkWords: CardFieldState
  maxFulltextChars: CardFieldState
  maxResponseBytes: CardFieldState
  maxExportChars: CardFieldState
  maxExportRefs: CardFieldState
  defaultStyle: CardFieldState
  defaultLocale: CardFieldState
}

/** The registration-side face the card's slot entry injects. */
export interface ZoteroCardFace extends CardActions {
  hooks: {
    /** Card snapshot bound by the renderer as useZoteroCard. */
    zoteroCard: SnapshotSource<ZoteroCardState>
  }
}

/** Bridges the `zotero` scope onto the page's staged form. */
export class ZoteroCardController {
  private readonly form: CardForm
  private readonly store: SnapshotSource<ZoteroCardState>
  private readonly scope: SettingsScope<unknown>

  /**
   * @param scope - the bound settings scope for the `zotero` namespace. The
   *   seam types the section generically; the settings wire validates it
   *   against the host Config schema, so reading it as a plain object record
   *   is the contract the host registration established.
   */
  constructor(scope: SettingsScope<unknown>) {
    this.scope = scope
    this.form = new CardForm(scope as SettingsScope<Record<string, unknown>>, FIELDS)
    this.store = this.form.bind(() => this.projection())
  }

  private projection(): ZoteroCardState {
    return {
      ...this.form.shell(),
      loading: this.scope.getSnapshot().status === 'loading',
      baseUrl: this.form.field('baseUrl'),
      provider: this.form.field('provider'),
      timeoutMs: this.form.field('timeoutMs'),
      maxSearchResults: this.form.field('maxSearchResults'),
      maxNoteScanRecords: this.form.field('maxNoteScanRecords'),
      maxEvidenceChars: this.form.field('maxEvidenceChars'),
      maxEvidencePassages: this.form.field('maxEvidencePassages'),
      maxDetailChars: this.form.field('maxDetailChars'),
      maxNoteBodyChars: this.form.field('maxNoteBodyChars'),
      maxNoteChars: this.form.field('maxNoteChars'),
      maxNoteRecords: this.form.field('maxNoteRecords'),
      maxAnnotationRecords: this.form.field('maxAnnotationRecords'),
      fulltextChunkWords: this.form.field('fulltextChunkWords'),
      maxFulltextChars: this.form.field('maxFulltextChars'),
      maxResponseBytes: this.form.field('maxResponseBytes'),
      maxExportChars: this.form.field('maxExportChars'),
      maxExportRefs: this.form.field('maxExportRefs'),
      defaultStyle: this.form.field('defaultStyle'),
      defaultLocale: this.form.field('defaultLocale'),
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

/** Re-export the namespace so the apply entry and the card share one spelling. */
export { ZOTERO_SETTINGS_NAMESPACE }
