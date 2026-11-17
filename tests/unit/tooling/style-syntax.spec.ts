/** Syntax-level policy regressions: alternate valid CSS must not bypass the style contract. */
import { describe, expect, it } from 'vitest'
import {
  stripComments,
  rulesOf,
  declarationsOf,
  tokenReferencesOf,
  unknownTokenViolations,
  bareFontScaleViolations,
  literalColorViolations,
  fullRoundRadiusViolations,
  stateBorderViolations,
  neutralBorderViolations,
  hoverMediaViolations,
  unreducedMotionViolations,
} from '../../../scripts/style-guard.mjs'

const palette = { dsw: ['--dsw-alias-label-primary'], dsh: [], ds: [] }
const sheet = (css: string) => ({ file: 'syntax.module.css', css })

describe('CSS syntax authority', () => {
  it('keeps imports, quoted braces and embedded semicolons out of rule boundaries', () => {
    const css =
      '@import "theme;a.css";\n@media (hover: hover) { .row:hover { content: "};/* literal */"; background-image: url("data:image/svg+xml;a;b"); } }'
    const stripped = stripComments(css)
    expect(stripped).toBe(css)
    const [rule] = rulesOf(stripped)
    expect(rule).toMatchObject({ selector: '.row:hover', atRules: ['@media (hover: hover)'] })
    expect(rule!.at).toBe(css.indexOf('.row'))
    expect(declarationsOf(rule!.body)).toEqual([
      { property: 'content', value: '"};/* literal */"' },
      { property: 'background-image', value: 'url(data:image/svg+xml;a;b)' },
    ])
  })
  it('rejects malformed CSS explicitly instead of ignoring the remainder', () => {
    expect(() => rulesOf('.row { color: var(--dsw-a);')).toThrow()
    expect(() => declarationsOf('color')).toThrow()
  })
  it('decodes escaped property, function and token names while preserving offsets', () => {
    const css =
      '.row { c\\6flor: v\\61r(--dsw-alias-label-primary); }\n.next { color: var(--dshx-misspelled); }'
    expect(declarationsOf(rulesOf(css)[0]!.body)[0]).toEqual({
      property: 'color',
      value: 'var(--dsw-alias-label-primary)',
    })
    expect(tokenReferencesOf(css)).toEqual(['--dsw-alias-label-primary', '--dshx-misspelled'])
    expect(unknownTokenViolations(sheet(css), palette)).toEqual([
      expect.objectContaining({ line: 2, detail: expect.stringContaining('--dshx-misspelled') }),
    ])
  })
})

describe('literal typography and colors', () => {
  it.each([
    '.875rem',
    '1.2em',
    '80%',
    '2ch',
    '2ex',
    '1vw',
    'small',
    'calc(var(--dsw-font-xs-13-font-size) + 1px)',
    'var(--dsw-font-xs-13-font-size, 13px)',
  ])('rejects an off-scale font size %s', (value) => {
    expect(bareFontScaleViolations(sheet(`.row { font-size: ${value}; }`), palette)).toHaveLength(1)
  })
  it.each([
    'red',
    'rebeccapurple',
    'r\\65 d',
    'oklch(.5 .2 20)',
    'lab(50% 20 20)',
    'lch(50% 20 20)',
    'hwb(20 10% 10%)',
    'color(display-p3 1 0 0)',
    'color-mix(in srgb, red, var(--dsw-alias-label-primary))',
    'var(--dsw-alias-label-primary, red)',
  ])('rejects a literal color %s', (value) => {
    expect(literalColorViolations(sheet(`.row { color: ${value}; }`), palette)).toHaveLength(1)
  })
  it('accepts non-color identifiers and inert quoted data without misclassifying them', () => {
    expect(
      literalColorViolations(
        sheet(
          '.row { font-family: red; content: "red #fff"; background: url("red.png"); color: currentColor; }',
        ),
        palette,
      ),
    ).toEqual([])
  })
  it('does not license the focus zoom size under an OR that includes fine pointers', () => {
    expect(
      bareFontScaleViolations(
        sheet('@media (pointer: coarse), (hover: hover) { .row { font-size: 16px; } }'),
        palette,
      ),
    ).toHaveLength(1)
    expect(
      bareFontScaleViolations(
        sheet('@media not (pointer: coarse) { .row { font-size: 16px; } }'),
        palette,
      ),
    ).toHaveLength(1)
  })
})

describe('border and radius semantics', () => {
  it.each([
    'border-top-left-radius: 50%',
    'border-end-start-radius: 100%',
    'border-radius: 100vmax',
    'border-radius: 9999px',
  ])('requires a round corner pairing for %s', (declaration) => {
    expect(fullRoundRadiusViolations(sheet(`.row { ${declaration}; }`), palette)).toHaveLength(1)
    expect(
      fullRoundRadiusViolations(sheet(`.row { ${declaration}; corner-shape: round; }`), palette),
    ).toEqual([])
  })
  it('expands independent border color and logical width declarations', () => {
    expect(
      neutralBorderViolations(
        sheet(
          '.row { border-width: 1px; border-style: solid; border-color: var(--dsw-alias-border-l2); }',
        ),
        palette,
      ),
    ).toHaveLength(1)
    expect(
      neutralBorderViolations(
        sheet(
          '.row { border-inline-width: 1px; border-inline-color: var(--dsw-alias-border-l2); }',
        ),
        palette,
      ),
    ).toHaveLength(1)
    expect(
      stateBorderViolations(
        sheet(
          '.row { border-block-start-width: .5px; border-block-start-color: var(--dsw-alias-state-success-primary); }',
        ),
        palette,
      ),
    ).toHaveLength(1)
    expect(
      neutralBorderViolations(
        sheet(
          '.row { border: 1px solid var(--dsw-alias-border-l2); border-color: var(--dsw-alias-state-success-primary); }',
        ),
        palette,
      ),
    ).toEqual([])
  })
})

describe('media and motion semantics', () => {
  it('recognizes escaped hover and refuses an OR or negation as a hover gate', () => {
    expect(hoverMediaViolations(sheet('.row:h\\6fver { opacity: .5; }'), palette)).toHaveLength(1)
    expect(
      hoverMediaViolations(
        sheet('@media (hover: hover), (pointer: coarse) { .row:hover { opacity: .5; } }'),
        palette,
      ),
    ).toHaveLength(1)
    expect(
      hoverMediaViolations(
        sheet('@media not (hover: hover) { .row:hover { opacity: .5; } }'),
        palette,
      ),
    ).toHaveLength(1)
    expect(
      hoverMediaViolations(
        sheet('@media (h\\6fver: h\\6fver) { .row:hover { opacity: .5; } }'),
        palette,
      ),
    ).toEqual([])
  })
  it('requires actual transition and animation disabling for the styled subject', () => {
    const animated = '.row { transition: color 1s; animation: spin 1s infinite; }'
    expect(
      unreducedMotionViolations(
        sheet(`${animated} @media (prefers-reduced-motion: reduce) { .row { opacity: 1; } }`),
        palette,
      ),
    ).toHaveLength(1)
    expect(
      unreducedMotionViolations(
        sheet(`${animated} @media (prefers-reduced-motion: reduce) { .row { transition: none; } }`),
        palette,
      ),
    ).toHaveLength(1)
    expect(
      unreducedMotionViolations(
        sheet(
          `${animated} @media (prefers-reduced-motion: reduce) { .row { transition-property: none; animation-name: none; } }`,
        ),
        palette,
      ),
    ).toEqual([])
  })
  it('accepts motion restricted to no-preference but refuses negated or partial reductions', () => {
    expect(
      unreducedMotionViolations(
        sheet('@media (prefers-reduced-motion: no-preference) { .row { animation: spin 1s; } }'),
        palette,
      ),
    ).toEqual([])
    expect(
      unreducedMotionViolations(
        sheet(
          '.row { animation: spin 1s; } @media not (prefers-reduced-motion: reduce) { .row { animation: none; } }',
        ),
        palette,
      ),
    ).toHaveLength(1)
    expect(
      unreducedMotionViolations(
        sheet(
          '.row { animation: spin 1s; } @media (prefers-reduced-motion: reduce) and (min-width: 999px) { .row { animation: none; } }',
        ),
        palette,
      ),
    ).toHaveLength(1)
  })
  it('does not treat a state-specific or later re-enabled reduction as global disabling', () => {
    const animated = '.row { transition: color 1s; }'
    expect(
      unreducedMotionViolations(
        sheet(
          `${animated} @media (prefers-reduced-motion: reduce) { .row[data-small] { transition: none; } }`,
        ),
        palette,
      ),
    ).toHaveLength(1)
    expect(
      unreducedMotionViolations(
        sheet(
          `${animated} @media (min-width: 999px) { @media (prefers-reduced-motion: reduce) { .row { transition: none; } } }`,
        ),
        palette,
      ),
    ).toHaveLength(1)
    expect(
      unreducedMotionViolations(
        sheet(
          `${animated} @media (prefers-reduced-motion: reduce) { .row { transition: none; } .row { transition: color 1s; } }`,
        ),
        palette,
      ),
    ).toHaveLength(1)
  })
})
