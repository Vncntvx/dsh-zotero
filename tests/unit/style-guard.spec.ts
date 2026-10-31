/**
 * The client stylesheets' mechanical guards (`scripts/style-guard.mjs`).
 *
 * Two halves, and both are needed. The synthetic cases prove each guard still
 * matches the form its docstring names — a parser that quietly stopped
 * descending into `@media` would fail open, and the tree would pass green. The
 * real-tree case proves the stylesheets in this repository conform today, so a
 * change that breaks one of those contracts fails here rather than being
 * noticed at a later visual review.
 *
 * The rules themselves, and why each one exists, are documented in the script;
 * this suite exercises them from the outside.
 * @module tests/unit/style-guard
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  bareFontScaleViolations,
  declarationsOf,
  formatViolation,
  fullRoundRadiusViolations,
  hoverMediaViolations,
  literalColorViolations,
  rulesOf,
  stateBorderViolations,
  stripComments,
  styleSources,
  styleViolations,
  tokenReferencesOf,
  unknownTokenViolations,
  unreducedMotionViolations,
} from '../../scripts/style-guard.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const palette = JSON.parse(
  readFileSync(join(root, 'tests', 'fixtures', 'style-tokens.json'), 'utf8'),
)

/** One stylesheet, as the guards receive it. */
const sheet = (css: string) => ({ file: 'probe.module.css', css })

/** The palette a synthetic case resolves against. */
const KNOWN = { dsw: ['--dsw-alias-label-primary'], dsh: ['--dsh-content-font-size'] }

describe('stripComments', () => {
  it('blanks a comment body without moving a single offset', () => {
    const css = 'a { color: red; } /* note\n   spanning lines */ b { top: 0; }'
    const stripped = stripComments(css)
    expect(stripped).toHaveLength(css.length)
    expect(stripped).not.toContain('note')
    expect(stripped.slice(css.indexOf('b {'))).toBe(css.slice(css.indexOf('b {')))
  })
})

describe('rulesOf', () => {
  it('reads a flat rule and its selector', () => {
    expect(rulesOf('.a { color: red; }')).toEqual([
      { selector: '.a', body: ' color: red; ', atRules: [], at: 0 },
    ])
  })

  it('descends into a media query and remembers the prelude', () => {
    const rules = rulesOf('@media (hover: hover) { .a:hover { color: red; } }')
    expect(rules).toHaveLength(1)
    expect(rules[0]?.selector).toBe('.a:hover')
    expect(rules[0]?.atRules).toEqual(['@media (hover: hover)'])
  })

  it('keeps a nested media query stack outermost first', () => {
    const css = '@media (hover: hover) { @media (min-width: 40em) { .a:hover { top: 0; } } }'
    expect(rulesOf(css)[0]?.atRules).toEqual(['@media (hover: hover)', '@media (min-width: 40em)'])
  })

  it('flattens keyframe steps out of the at-rule block', () => {
    const css = '@keyframes fade { from { opacity: 0; } 50% { opacity: 1; } }'
    expect(rulesOf(css).map((rule) => rule.selector)).toEqual(['from', '50%'])
  })

  it('reports the offset a violation is attributed to', () => {
    const css = '.a {\n  top: 0;\n}\n\n.b {\n  top: 1px;\n}'
    const line = css.slice(0, rulesOf(css)[1]?.at).split('\n').length
    expect(line).toBe(5)
  })
})

describe('declarationsOf', () => {
  it('splits on semicolons and lower-cases the property', () => {
    expect(declarationsOf(' DISPLAY: flex; gap: 0; ')).toEqual([
      { property: 'display', value: 'flex' },
      { property: 'gap', value: '0' },
    ])
  })

  it('keeps a colon inside the value out of the split', () => {
    expect(declarationsOf('background: url(a:b); ')).toEqual([
      { property: 'background', value: 'url(a:b)' },
    ])
  })

  it('drops a trailing empty chunk', () => {
    expect(declarationsOf('top: 0;')).toHaveLength(1)
    expect(declarationsOf('')).toEqual([])
  })
})

describe('tokenReferencesOf', () => {
  it('reads a token and skips an unrelated custom property', () => {
    const css = '.a { color: var(--dsw-alias-label-primary); --local: 1px; top: var(--local); }'
    expect(tokenReferencesOf(css)).toEqual(['--dsw-alias-label-primary'])
  })
})

describe('unknownTokenViolations', () => {
  it('fires on an invented name and names it', () => {
    const violations = unknownTokenViolations(
      sheet('.a { color: var(--dsw-alias-label-error); }'),
      KNOWN,
    )
    expect(violations).toHaveLength(1)
    expect(violations[0]?.detail).toContain('--dsw-alias-label-error')
  })

  it('accepts a published token and a declared seam', () => {
    const css =
      '.a { color: var(--dsw-alias-label-primary); font-size: var(--dsh-content-font-size); }'
    expect(unknownTokenViolations(sheet(css), KNOWN)).toEqual([])
  })

  it('fires on a seam the snapshot does not declare', () => {
    expect(unknownTokenViolations(sheet('.a { top: var(--dsh-unknown); }'), KNOWN)).toHaveLength(1)
  })
})

describe('bareFontScaleViolations', () => {
  it('fires on a literal size and on a literal line-height', () => {
    expect(bareFontScaleViolations(sheet('.a { font-size: 13px; }'), KNOWN)).toHaveLength(1)
    expect(bareFontScaleViolations(sheet('.a { line-height: 20px; }'), KNOWN)).toHaveLength(1)
  })

  it('accepts a token and a size that rides the reader axis', () => {
    expect(bareFontScaleViolations(sheet('.a { font: var(--dsw-font-xs-13); }'), KNOWN)).toEqual([])
    const axis = '.a { font-size: var(--dsh-content-font-size-secondary, 13px); }'
    expect(bareFontScaleViolations(sheet(axis), KNOWN)).toEqual([])
  })

  it('licenses the 16px focus-zoom guard and nothing else in that query', () => {
    const guarded = '@media (pointer: coarse) { .a { font-size: 16px; } }'
    expect(bareFontScaleViolations(sheet(guarded), KNOWN)).toEqual([])
    expect(bareFontScaleViolations(sheet(guarded.replace('16px', '17px')), KNOWN)).toHaveLength(1)
  })

  it('does not license 16px outside the query', () => {
    expect(bareFontScaleViolations(sheet('.a { font-size: 16px; }'), KNOWN)).toHaveLength(1)
  })
})

describe('literalColorViolations', () => {
  it('fires on a hex, an rgb() and an hsl()', () => {
    for (const value of ['#fff', '#ffffff', 'rgb(0 0 0)', 'rgba(0, 0, 0, .5)', 'hsl(0 0% 0%)']) {
      expect(literalColorViolations(sheet(`.a { color: ${value}; }`), KNOWN)).toHaveLength(1)
    }
  })

  it('accepts a token and the mask coverage value', () => {
    expect(
      literalColorViolations(sheet('.a { color: var(--dsw-alias-label-primary); }'), KNOWN),
    ).toEqual([])
    const mask = '.a { mask-image: linear-gradient(180deg, #000 65%, transparent 100%); }'
    expect(literalColorViolations(sheet(mask), KNOWN)).toEqual([])
  })

  it('does not let the mask allowance carry a real colour', () => {
    expect(
      literalColorViolations(sheet('.a { mask-image: linear-gradient(#fff, #000); }'), KNOWN),
    ).toHaveLength(1)
  })
})

describe('fullRoundRadiusViolations', () => {
  it('fires on an unpaired 50%, 100% and pill radius', () => {
    for (const value of ['50%', '100%', '999px', '9999px']) {
      expect(
        fullRoundRadiusViolations(sheet(`.a { border-radius: ${value}; }`), KNOWN),
      ).toHaveLength(1)
    }
  })

  it('accepts a paired full round', () => {
    const css = '.a { border-radius: 50%; corner-shape: round; }'
    expect(fullRoundRadiusViolations(sheet(css), KNOWN)).toEqual([])
  })

  it('leaves a ladder radius alone', () => {
    expect(
      fullRoundRadiusViolations(sheet('.a { border-radius: var(--dsw-radius-sm); }'), KNOWN),
    ).toEqual([])
  })
})

describe('stateBorderViolations', () => {
  const base = '.badge {\n  border: 0.5px solid var(--dsw-alias-border-l2);\n}'

  it('fires when a variant restates only the colour of a hairline base', () => {
    const css = `${base}\n.badge[data-tone='success'] { border-color: var(--dsw-alias-state-success-primary); }`
    const violations = stateBorderViolations(sheet(css), KNOWN)
    expect(violations).toHaveLength(1)
    expect(violations[0]?.detail).toContain('hairline')
  })

  it('accepts a variant that states the full pixel', () => {
    const css = [
      base,
      ".badge[data-tone='success'] { border-width: 1px; border-color: var(--dsw-alias-state-success-primary); }",
    ].join('\n')
    expect(stateBorderViolations(sheet(css), KNOWN)).toEqual([])
  })

  it('accepts a state accent bar on a wider side', () => {
    const css = [
      '.row { border-left: 2px solid transparent; }',
      '.rowActive { border-left-color: var(--dsw-alias-state-business-primary); }',
    ].join('\n')
    expect(stateBorderViolations(sheet(css), KNOWN)).toEqual([])
  })

  it('fires on a state border stated at hairline weight outright', () => {
    const css = '.badge { border: 0.5px solid var(--dsw-alias-state-success-primary); }'
    expect(stateBorderViolations(sheet(css), KNOWN)).toHaveLength(1)
  })

  it('expands a four-value border-width the way CSS does', () => {
    const css = [
      base,
      ".badge[data-tone='warn'] { border-width: 0.5px 0.5px 0.5px 0.5px; border-color: var(--dsw-alias-state-warn-primary); }",
    ].join('\n')
    expect(stateBorderViolations(sheet(css), KNOWN)).toHaveLength(1)
    const fixed = css.replace(/0\.5px 0\.5px 0\.5px 0\.5px/, '0.5px 1px 0.5px 1px')
    expect(stateBorderViolations(sheet(fixed), KNOWN)).toHaveLength(1)
  })
})

describe('hoverMediaViolations', () => {
  it('fires on an ungated hover rule and accepts a gated one', () => {
    expect(hoverMediaViolations(sheet('.a:hover { color: red; }'), KNOWN)).toHaveLength(1)
    expect(
      hoverMediaViolations(sheet('@media (hover: hover) { .a:hover { top: 0; } }'), KNOWN),
    ).toEqual([])
  })

  it('accepts a hover rule inside a stack that gates on capability', () => {
    const css = '@media (hover: hover) { @media (min-width: 40em) { .a:hover { top: 0; } } }'
    expect(hoverMediaViolations(sheet(css), KNOWN)).toEqual([])
  })
})

describe('unreducedMotionViolations', () => {
  it('fires on a transition with no reduction in the sheet', () => {
    const violations = unreducedMotionViolations(sheet('.a { transition: color 120ms; }'), KNOWN)
    expect(violations).toHaveLength(1)
    expect(violations[0]?.detail).toContain('.a')
  })

  it('accepts a class the reduction block names', () => {
    const css = [
      '.a { transition: color 120ms; }',
      '@media (prefers-reduced-motion: reduce) { .a { transition: none; } }',
    ].join('\n')
    expect(unreducedMotionViolations(sheet(css), KNOWN)).toEqual([])
  })

  it('reduces the subject of a descendant selector, not its ancestor', () => {
    const css = [
      '.row .icon { transition: transform 120ms; }',
      '@media (prefers-reduced-motion: reduce) { .row { transition: none; } }',
    ].join('\n')
    expect(unreducedMotionViolations(sheet(css), KNOWN)).toHaveLength(1)
    const fixed = css.replace('.row {', '.icon {')
    expect(unreducedMotionViolations(sheet(fixed), KNOWN)).toEqual([])
  })

  it('reads a pseudo-class off the subject before matching', () => {
    const css = [
      '.link:hover { transition: color 120ms; }',
      '@media (prefers-reduced-motion: reduce) { .link { transition: none; } }',
    ].join('\n')
    expect(unreducedMotionViolations(sheet(css), KNOWN)).toEqual([])
  })

  it('ignores a transition that is already the reduction', () => {
    const css = '@media (prefers-reduced-motion: reduce) { .a { transition: none; } }'
    expect(unreducedMotionViolations(sheet(css), KNOWN)).toEqual([])
  })
})

describe('styleViolations', () => {
  it('aggregates every guard over every source', () => {
    const css = '.a { color: #fff; font-size: 13px; }\n.b:hover { top: 0; }'
    expect(styleViolations([sheet(css)], KNOWN).length).toBe(3)
  })
})

describe('styleSources', () => {
  it('finds every stylesheet under the scanned root, sorted', () => {
    const sources = styleSources()
    expect(sources.length).toBeGreaterThanOrEqual(15)
    expect(sources.map((source) => source.file)).toEqual(
      sources
        .map((source) => source.file)
        .slice()
        .sort(),
    )
    for (const source of sources) {
      expect(source.file.startsWith('src/')).toBe(true)
      expect(source.css.length).toBeGreaterThan(0)
    }
  })
})

describe('formatViolation', () => {
  it('prints the location, the reason and the remedy', () => {
    const lines = formatViolation({
      file: 'src/a.module.css',
      line: 12,
      selector: '.a',
      detail: 'detail',
      fix: 'fix',
    }).split('\n')
    expect(lines).toEqual(['  src/a.module.css:12  .a', '    detail', '    fix: fix'])
  })

  it('omits the line when the offset is unknown', () => {
    const where = formatViolation({
      file: 'src/a.css',
      line: 0,
      selector: '',
      detail: 'd',
      fix: 'f',
    })
    expect(where.split('\n')[0]).toBe('  src/a.css')
  })
})

describe('the committed stylesheets', () => {
  it('conform to every guard', () => {
    expect(styleViolations(styleSources(), palette).map(formatViolation)).toEqual([])
  })
})
