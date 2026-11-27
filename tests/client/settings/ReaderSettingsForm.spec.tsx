// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useSyncExternalStore } from 'react'
import { SettingsForm } from '@deepseek-ai/dsh-client-ui-primitives'
import { afterEach, expect, it } from 'vitest'
import { ReaderSettingsForm } from '../../../src/client/ReaderSettingsForm.tsx'
import { formLabels } from '../../../src/client/ZoteroSettingsSection.tsx'
import { en, zh } from '../../../src/client/locales.ts'
import { ReaderSettingsController } from '../../../src/client/reader-settings-controller.ts'
import { fakeScope } from '../helpers/fake-scope.ts'
import { makeTranslate } from '../helpers/mock-translate.ts'

function Form({ controller }: { controller: ReaderSettingsController }) {
  const face = controller.inject()
  const state = useSyncExternalStore(
    face.hooks.readerCard.subscribe,
    face.hooks.readerCard.getSnapshot,
  )
  const t = makeTranslate(zh)
  return (
    <SettingsForm labels={formLabels(t)} state={state} onSave={face.save} onDiscard={face.discard}>
      <ReaderSettingsForm t={t} state={state} actions={face} />
    </SettingsForm>
  )
}

afterEach(cleanup)

it('edits and saves history and reading-position preferences with validation', async () => {
  const scope = fakeScope({ value: { historyLimit: 50, persistReadingState: true } })
  const controller = new ReaderSettingsController(scope)
  render(<Form controller={controller} />)

  expect(screen.getByText(zh.groupReaderPreferences)).toBeDefined()
  fireEvent.change(screen.getByRole('textbox', { name: zh.readerHistoryLimit }), {
    target: { value: '125' },
  })
  fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${zh.save}`) }))
  await waitFor(() =>
    expect(scope.writes).toContainEqual({ op: 'set', field: 'historyLimit', value: 125 }),
  )

  fireEvent.click(screen.getByRole('checkbox', { name: zh.readerPersistReadingState }))
  fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${zh.save}`) }))
  await waitFor(() =>
    expect(scope.writes).toContainEqual({ op: 'set', field: 'persistReadingState', value: false }),
  )

  fireEvent.click(screen.getByRole('checkbox', { name: zh.readerCaptureWatermark }))
  fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${zh.save}`) }))
  await waitFor(() =>
    expect(scope.writes).toContainEqual({ op: 'set', field: 'captureWatermark', value: true }),
  )

  fireEvent.click(screen.getByRole('button', { name: zh.readerTranslationTarget }))
  fireEvent.click(screen.getByRole('menuitem', { name: 'French' }))
  fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${zh.save}`) }))
  await waitFor(() =>
    expect(scope.writes).toContainEqual({
      op: 'set',
      field: 'defaultTranslationTarget',
      value: 'fr',
    }),
  )

  fireEvent.change(screen.getByRole('textbox', { name: zh.readerHistoryLimit }), {
    target: { value: '501' },
  })
  expect(
    screen.getByRole('button', { name: new RegExp(`^${zh.save}`) }).hasAttribute('disabled'),
  ).toBe(true)
  controller.dispose()
})

it('provides the same settings fields in English', () => {
  const scope = fakeScope({ value: { historyLimit: 50, persistReadingState: true } })
  const controller = new ReaderSettingsController(scope)
  const t = makeTranslate(en)
  const face = controller.inject()
  const state = face.hooks.readerCard.getSnapshot()
  render(<ReaderSettingsForm t={t} state={state} actions={face} />)
  expect(screen.getByText(en.readerHistoryLimit)).toBeDefined()
  expect(screen.getByText(en.readerPersistReadingState)).toBeDefined()
  expect(screen.getByText(en.readerCaptureWatermark)).toBeDefined()
  controller.dispose()
})

it('resets every overridden Reader field through the shared action row', async () => {
  const overrides = {
    historyLimit: 50,
    persistReadingState: true,
    captureWatermark: false,
    defaultTranslationTarget: 'auto',
  }
  const scope = fakeScope({
    value: overrides,
    base: overrides,
    user: overrides,
  })
  const controller = new ReaderSettingsController(scope)
  render(<Form controller={controller} />)

  const resetButtons = screen.getAllByText(zh.reset)
  expect(resetButtons).toHaveLength(4)
  for (const button of resetButtons) fireEvent.click(button)
  fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${zh.save}`) }))
  await waitFor(() =>
    expect(scope.writes.map(({ op, field }) => [op, field])).toEqual([
      ['unset', 'historyLimit'],
      ['unset', 'persistReadingState'],
      ['unset', 'captureWatermark'],
      ['unset', 'defaultTranslationTarget'],
    ]),
  )
  controller.dispose()
})
