// @vitest-environment jsdom
/** Observable production capability adapter: accepted config, access, connection and mount. */
import { act, cleanup, fireEvent, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { EnrichmentFormController } from '../../../src/client/enrichment-form-controller.ts'
import { emptyCredentialPort } from '../helpers/credential-port.ts'
import { ENRICHMENT_DEFAULTS } from '../../../src/enrichment-preferences.ts'
import { parseIntegrationWorld, en, PARSE_ACTIONS } from './support/parse-integration.tsx'

const worlds: ReturnType<typeof parseIntegrationWorld>[] = []
beforeEach(() => localStorage.clear())
afterEach(() => {
  cleanup()
  for (const world of worlds.splice(0)) world.dispose()
})
async function mount() {
  const runtime = parseIntegrationWorld()
  worlds.push(runtime)
  runtime.mount()
  fireEvent.click(screen.getByRole('button', { name: en.libraryParseUrl }))
  fireEvent.change(screen.getByRole('textbox', { name: en.parseUrl }), {
    target: { value: 'https://papers.example.org/paper.pdf' },
  })
  await act(async () => {})
  return runtime
}
function confirm() {
  return screen.getByRole('button', { name: en.parseConfirm }) as HTMLButtonElement
}

describe('parsing capability integration', () => {
  it('uses committed enrichment values while a settings controller holds a different draft', async () => {
    const runtime = await mount()
    act(() => runtime.form.publish({ value: { ...ENRICHMENT_DEFAULTS, mode: 'free' } }))
    const editor = new EnrichmentFormController(runtime.form, emptyCredentialPort)
    try {
      act(() => {
        editor.inject().edit('mode', 'pro')
      })
      expect(screen.getByText(en.parseModeFree)).toBeDefined()
      expect(confirm().disabled).toBe(false)
      expect(runtime.remote.startDocumentParse).not.toHaveBeenCalled()
      await act(async () => {
        await editor.inject().save()
      })
      expect(screen.getByText(en.parseModePro)).toBeDefined()
      expect(screen.getByText(/200 MB.*200 pages/)).toBeDefined()
      expect(confirm().disabled).toBe(false)
      expect(runtime.remote.startDocumentParse).not.toHaveBeenCalled()
    } finally {
      editor.dispose()
    }
  })

  it('distinguishes access, connection, and component withdrawal and starts no work on recovery', async () => {
    const runtime = await mount()
    expect(confirm().disabled).toBe(false)
    act(() =>
      runtime.access.publish(
        new Set(PARSE_ACTIONS.filter((action) => action !== 'zotero/startDocumentParse')),
      ),
    )
    expect(screen.getByText(en.parsePermission)).toBeDefined()
    expect(screen.queryByText(en.parseUnavailable)).toBeNull()
    expect(confirm().disabled).toBe(true)
    act(() => runtime.access.publish(new Set(PARSE_ACTIONS)))
    act(() => runtime.connection.publish('disconnected'))
    expect(screen.getByText(en.parseOffline)).toBeDefined()
    expect(runtime.stopRows).toHaveBeenCalled()
    act(() => runtime.connection.publish('connected'))
    act(() => runtime.withdraw())
    // The manager tab withdraws with the component instead of keeping a dialog
    // open against a withdrawn capability.
    expect(screen.getByText(en.parsedManagerUnavailable)).toBeDefined()
    expect(screen.queryByRole('dialog')).toBeNull()
    act(() => runtime.serve())
    await act(async () => {})
    // Re-enter the manager's URL form: the withdrawn tab dropped its dialog,
    // so a fresh submission starts from a clean selection.
    fireEvent.click(screen.getByRole('button', { name: en.libraryParseUrl }))
    fireEvent.change(screen.getByRole('textbox', { name: en.parseUrl }), {
      target: { value: 'https://papers.example.org/paper.pdf' },
    })
    await act(async () => {})
    expect(confirm().disabled).toBe(false)
    expect(runtime.remote.startDocumentParse).not.toHaveBeenCalled()
    expect(runtime.jobs.kill).not.toHaveBeenCalled()
  })

  it('keeps read denial explicit and fences cancellation with this session grant', async () => {
    const runtime = await mount()
    act(() =>
      runtime.access.publish(
        new Set(PARSE_ACTIONS.filter((action) => action !== 'zotero/documentArtifact')),
      ),
    )
    expect(screen.getByText(en.parseReadPermission)).toBeDefined()
    act(() => runtime.access.publish(new Set(PARSE_ACTIONS)))
    fireEvent.click(confirm())
    await act(async () => {})
    act(() =>
      runtime.access.publish(new Set(PARSE_ACTIONS.filter((action) => action !== 'job/kill'))),
    )
    const cancel = screen.getByRole('button', { name: en.parseCancel }) as HTMLButtonElement
    expect(cancel.disabled).toBe(true)
    fireEvent.click(cancel)
    expect(runtime.jobs.kill).not.toHaveBeenCalled()
    act(() => runtime.removed.publish(true))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(runtime.jobs.kill).not.toHaveBeenCalled()
    expect(runtime.port.recentUrl('parse-session')).toBeUndefined()
  })
})
