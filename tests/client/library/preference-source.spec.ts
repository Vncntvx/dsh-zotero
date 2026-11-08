/** Invalid accepted settings are surfaced rather than replaced with runtime defaults. */
import { expect, it, vi } from 'vitest'
import { createLibraryPreferenceSource } from '../../../src/client/library-preferences.tsx'
import { libraryPreferencesOf } from '../../../src/library-preferences.ts'
import { fakeScope } from '../helpers/fake-scope.ts'
it.each([
  { rightSidebarEnabled: 'true' },
  { titleLines: 3 },
  { detailExpandedSections: ['notes', 'notes'] },
])('refuses malformed accepted preferences %j', (value) => {
  expect(() => libraryPreferencesOf(value)).toThrow('Invalid library preference')
})
it('waits for the namespace and CSL settings, then publishes only accepted snapshots', () => {
  const library = fakeScope({ status: 'loading' })
  const core = fakeScope({ status: 'loading' })
  const source = createLibraryPreferenceSource(library, core)
  const listener = vi.fn()
  const unsubscribe = source.subscribe(listener)
  expect(source.getSnapshot().preferences).toBeUndefined()
  library.publish({ status: 'ready', value: { listDensity: 'compact' } })
  expect(source.getSnapshot().preferences?.listDensity).toBe('compact')
  expect(source.getSnapshot().citationPending).toBe(true)
  core.publish({ status: 'ready', value: { defaultStyle: 'apa', defaultLocale: 'en-US' } })
  expect(source.getSnapshot().citation).toEqual({ style: 'apa', locale: 'en-US' })
  library.publish({ status: 'unavailable' })
  expect(source.getSnapshot().error).toContain('unavailable')
  library.publish({ status: 'ready', value: { titleLines: 9 } })
  expect(source.getSnapshot().error).toContain('titleLines')
  unsubscribe()
  source.dispose()
  expect(library.unsubscribes).toBe(1)
  expect(core.unsubscribes).toBe(1)
})
