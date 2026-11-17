// The parsed-manager sheet's responsive contracts, read as source text: jsdom
// evaluates no stylesheet geometry, and a real-browser check cannot live in
// this suite, so the rules that keep the toolbar and the rows intact are
// asserted where they are written. `readFileSync` because Vite's `?raw` runs
// `.module.css` through the CSS pipeline, which returns the class map.
// @module tests/client/enrichment/parsed-manager-sheet
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const sheet = readFileSync(
  resolve(
    dirname(fileURLToPath(import.meta.url)),
    '../../../src/client/enrichment/parsed-manager.module.css',
  ),
  'utf8',
)

describe('parsed manager sheet responsive contracts', () => {
  it('never lets a toolbar text button rewrap its label', () => {
    // The host Button has no white-space contract: a squeezed label lines out
    // of the fixed-height box. Text seats keep their natural width; the
    // search is the one shrinking part.
    expect(sheet).toMatch(/\.textSeat\.textSeat\s*\{[^}]*white-space:\s*nowrap/)
    expect(sheet).toMatch(/\.textSeat\.textSeat\s*\{[^}]*flex:\s*none/)
  })

  it('collapses the URL parse entry to an icon seat instead of squeezing its label', () => {
    // Below the ladder step the label hides and the button pins to the icon
    // seat; the accessible name stays on the button in either form.
    const adapter = readFileSync(
      new URL('../../../src/client/components/IconButton.module.css', import.meta.url),
      'utf8',
    )
    const ladder = adapter.slice(adapter.indexOf('@container (max-width: 360px)'))
    expect(ladder).toMatch(/\.responsiveLabel\s*\{[^}]*display:\s*none/)
    expect(ladder).toMatch(/\.responsiveButton\.responsiveButton\s*\{[^}]*width:\s*28px/)
    expect(ladder).toMatch(/\.responsiveButton\.responsiveButton\s*\{[^}]*padding-inline:\s*0/)
  })

  it('keeps row metadata ellipsis-truncated at every width', () => {
    // A wrapped metadata paragraph floats the three row actions mid-paragraph;
    // truncation keeps them on the row's action line. No container step may
    // reintroduce `white-space: normal` on `.metaCopy`.
    expect(sheet).toMatch(/\.metaCopy\s*\{[^}]*white-space:\s*nowrap/)
    expect(sheet).not.toMatch(/\.metaCopy\s*\{[^}]*white-space:\s*normal/)
  })

  it('clips the rows bleed so the surface never scrolls sideways', () => {
    // Rows bleed 8px past the surface edge (`margin: 0 -8px`); without a clip
    // the list reports 8px of horizontal overflow at every width.
    expect(sheet).toMatch(/\.list\s*\{[^}]*overflow-x:\s*clip/)
  })
})
