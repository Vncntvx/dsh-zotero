// @vitest-environment jsdom
/**
 * Shared harness for the enrichment settings specs: the real section under the
 * primitives stub, a fake scope, and a full model port with spies.
 * @module tests/client/enrichment/support
 */

import { cleanup, render, screen } from '@testing-library/react'
import { useSyncExternalStore } from 'react'
import { vi } from 'vitest'
import { EnrichmentSettingsSection } from '../../../src/client/EnrichmentSettingsSection.tsx'
import type { EnrichmentSettingsSectionProps } from '../../../src/client/EnrichmentSettingsSection.tsx'
import type { ZoteroSemanticModelStatusResultView } from '../../../src/contract.ts'
import {
  EnrichmentFormController,
  type EnrichmentCardFace,
  type EnrichmentCardState,
  type EnrichmentModelPort,
} from '../../../src/client/enrichment-form-controller.ts'
import { en, zh } from '../../../src/client/locales.ts'
import { fakeScope } from '../helpers/fake-scope.ts'
import { makeTranslate } from '../helpers/mock-translate.ts'

export interface Harness {
  readonly face: EnrichmentCardFace
  readonly snapshot: () => EnrichmentCardState
  readonly writes: () => Array<{ op: string; field: string; value?: unknown }>
}

/** A full model port with spies; override single arms per test. */
export function modelPortOf(overrides: Partial<EnrichmentModelPort> = {}): EnrichmentModelPort {
  const status: ZoteroSemanticModelStatusResultView = {
    model: 'balanced',
    ready: false,
    downloading: false,
    path: '',
    downloadedBytes: 0,
    totalBytes: 0,
    percent: 0,
  }
  return {
    semanticModelStatus: vi.fn(async () => ({ ok: true as const, value: { ...status } })),
    downloadSemanticModel: vi.fn(async () => ({
      ok: true as const,
      value: { success: true, model: 'balanced', status: 'started' as const, path: '' },
    })),
    cancelSemanticModelDownload: vi.fn(async () => ({
      ok: true as const,
      value: { cancelled: false },
    })),
    verifySemanticModel: vi.fn(async () => ({
      ok: true as const,
      value: { ...status, ready: true, percent: 100 },
    })),
    ...overrides,
  }
}

/** Mount the enrichment section against a fake scope; cleaned up by the spec's afterEach. */
export function mountHarness(
  options: Parameters<typeof fakeScope>[0] = {},
  view: 'summary' | 'page' = 'page',
  modelPort?: EnrichmentModelPort,
): Harness {
  const scope = fakeScope(options)
  const controller = new EnrichmentFormController(
    scope,
    {
      describe: async () => ({ ok: true, value: {} }),
      set: async () => ({ ok: true, value: undefined }),
    },
    modelPort,
  )
  const face = controller.inject()

  function Section() {
    const state = useSyncExternalStore(
      face.hooks.enrichmentCard.subscribe,
      face.hooks.enrichmentCard.getSnapshot,
    )
    const props = {
      view,
      t: makeTranslate(zh),
      useEnrichmentCard: (selector: (snapshot: EnrichmentCardState) => unknown) => selector(state),
      edit: face.edit,
      resetField: face.resetField,
      save: face.save,
      discard: face.discard,
      downloadModel: face.downloadModel,
      cancelModelDownload: face.cancelModelDownload,
      verifyModel: face.verifyModel,
      checkModelStatus: face.checkModelStatus,
    } as unknown as EnrichmentSettingsSectionProps
    return <EnrichmentSettingsSection {...props} />
  }
  render(<Section />)
  return {
    face,
    snapshot: () => face.hooks.enrichmentCard.getSnapshot(),
    writes: () => scope.writes,
  }
}

export { cleanup, screen, zh, en }
