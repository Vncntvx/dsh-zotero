import { expect, it } from 'vitest'
import { ZOTERO_READ_TOOL_NAMES } from '../../src/constants.js'
import ReaderService from '../../src/reader/index.js'
import { setupCompositionLane } from '../helpers/lanes/composition-lane.js'

it('mounts Reader only when its loader row is enabled and preserves core tools', async () => {
  const base = await setupCompositionLane()
  try {
    expect(base.context.get('reader')).toBeUndefined()
    expect(base.registeredToolNames().sort()).toEqual([...ZOTERO_READ_TOOL_NAMES].sort())
  } finally {
    await base.dispose()
  }

  const enabled = await setupCompositionLane([
    { id: 'reader', disabled: false, config: { historyLimit: 25 } },
  ])
  try {
    expect(enabled.context.get('reader')).toBeInstanceOf(ReaderService)
    expect(enabled.context.reader.currentConfig).toEqual({
      historyLimit: 25,
      persistReadingState: true,
      defaultTranslationTarget: 'auto',
      captureWatermark: false,
    })
    expect(enabled.registeredToolNames().sort()).toEqual([...ZOTERO_READ_TOOL_NAMES].sort())
  } finally {
    await enabled.dispose()
  }
  expect(enabled.context.get('reader')).toBeUndefined()
})
