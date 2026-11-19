import { controlStyleViolations } from './shared/control-style-ownership.mjs'
import {
  stripCssComments,
  styleRules,
  styleDeclarations,
  tokenReferences,
  valueNodes,
  boxValues,
  colorLiterals,
  mediaRequires,
  mediaCovers,
  selectorHasHover,
  selectorBaseClass,
  selectorSubjects,
  reductionSubjects,
} from './shared/css-syntax.mjs'
/**
 * The browser stylesheets' mechanical guards.
 *
 * Feature CSS in this plugin owns no design decisions. `ui-theme` publishes the
 * palette (`--dsw-*`) and the user-preference seams (`--dsh-*`), and every
 * sheet here consumes them; `ui-primitives` owns the geometry of the controls
 * this plugin reuses. Both contracts are invisible in a diff and decay without
 * a failing test, which is why they are checked mechanically:
 *
 * 1. **Token references resolve.** A misspelt or invented token is silently
 *    dropped by the browser, so the declaration does nothing and the element
 *    falls back to the inherited value. `.diagFetchError` shipped
 *    `var(--dsw-alias-label-error)` — a name the theme never defined — and read
 *    as `inherit` for as long as it existed. Every reference is now resolved
 *    against the snapshot in `tests/fixtures/style-tokens.json`.
 * 2. **Type is on the ladder.** A literal `font-size`/`line-height` opts out of
 *    the typography scale and, more importantly, out of the user's font-size
 *    axis: the reader who raised their size to 22px found these surfaces
 *    unchanged. The one legitimate literal is the 16px focus-zoom guard,
 *    which is why the exception is declared rather than the rule widened.
 * 3. **Colour comes from the palette.** A literal hex value cannot follow the
 *    dark palette, the high-contrast palette, or a brand override. The mask
 *    gradients are the exception the platform itself makes: `mask-image` reads
 *    alpha only, so `#000` there is a coverage value, not a colour.
 * 4. **Full-round radii stay round.** `corner-shape.css` caps the corner
 *    profile, so a `50%`/pill radius without a paired `corner-shape: round`
 *    renders as a squircle. The theme's own stylesheet guard enforces the
 *    pairing; feature CSS has to hold the same line.
 * 5. **State borders are one pixel, neutral borders are half.** A hairline
 *    (0.5px) border in a state colour reads as a tint rather than a mark: it
 *    was invisible at 1× and mushy at 2×, so a state border carries the full
 *    pixel. A neutral border token is the opposite: a separator drawn at 1px
 *    sits heavier than every other divider in the host (1 or 2 device pixels at
 *    1×, 2 or 4 at 2×), so a neutral solid border is 0.5px. A decorative rail
 *    drawn in a neutral colour is declared in
 *    {@link NEUTRAL_BORDER_ACCENTS} rather than quietly widening the rule.
 * 6. **Hover is capability-gated.** An ungated `:hover` sticks after a tap on
 *    touch hardware, leaving the last-tapped control in its hover dress.
 * 7. **Motion is reducible.** A reader who asked for less motion gets no
 *    transition. The reduction is a hand-written list of class names in a
 *    second rule, which is exactly the kind of list that goes stale: the audit
 *    that produced this guard found eight entries naming rules that no longer
 *    animate, and thirteen classes animating with no entry at all.
 *
 * The predicates below are exported and driven by `tests/unit/tooling/style-guard` so
 * the guards cannot decay: a parser that stopped matching the form its
 * docstring names would otherwise fail the suite green.
 * @module scripts/style-guard
 */

import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * One stylesheet, as the guards receive it.
 * @typedef {{ file: string, css: string }} StyleSource
 */

/**
 * The published token names a reference may resolve to, mirroring
 * `TokenPalette` in `style-guard.d.mts`.
 * @typedef {{ dsw: string[], dsh?: string[], ds?: string[] }} TokenPalette
 */

/**
 * One rule broken by one guard, mirroring `StyleViolation` in `style-guard.d.mts`.
 * @typedef {{ file: string, line: number, selector: string, detail: string, fix: string }} StyleViolation
 */

/** @typedef {'top' | 'right' | 'bottom' | 'left'} Side */

/**
 * A border width per side, where the rule states none.
 * @typedef {Partial<Record<Side, number>>} SideWidths
 */

/** @typedef {ReadonlyArray<{ property: string, value: string }>} Declarations */

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** Directory scanned for stylesheets, relative to the repository root. */
export const STYLE_ROOT = 'src'

/** Extension the guard reads. */
export const STYLE_EXTENSION = '.css'

/**
 * The one literal `font-size` the ladder allows, and the query that licenses
 * it: iOS zooms the whole page when a form control is focused below 16px, so a
 * touch-only rule must state 16px outright rather than scale with the reader.
 */
export const FOCUS_ZOOM_GUARD = { query: 'pointer: coarse', value: '16px' }

/** Properties whose literal `#000` is a coverage value rather than a colour. */
export const MASK_PROPERTIES = ['mask', 'mask-image', '-webkit-mask-image']

/**
 * Border sides, in the order a shorthand writes them.
 * @type {Side[]}
 */
const SIDES = ['top', 'right', 'bottom', 'left']

// Focus rules inherit the base field's border width.
const FOCUS_STATE = /:focus(?:-visible|-within)?(?![\w-])/

/**
 * The physical sides each logical border shorthand paints.
 * @type {Record<string, Side[]>}
 */
const LOGICAL_SIDES = {
  'border-block': ['top', 'bottom'],
  'border-inline': ['right', 'left'],
}

/** A border thinner than this reads as a tint instead of a mark. */
const STATE_BORDER_FLOOR = 1

/** A neutral separator wider than this sits heavier than the host's dividers. */
const NEUTRAL_BORDER_CEILING = 0.5

/**
 * Declared exceptions to the neutral hairline rule: a decorative bar drawn in a
 * neutral colour, where the width is the mark rather than a separator. Each is
 * matched by the stylesheet's repo-relative path and one of the rule's
 * selectors.
 */
export const NEUTRAL_BORDER_ACCENTS = [
  {
    file: 'src/client/components/workspace/workspace.module.css',
    selector: '.quoteBody',
    reason: 'a quote rail: the bar is the mark, not a divider',
  },
]

/**
 * Blank out comment bodies while preserving every offset, so a match position
 * still maps to its real line.
 * @param css - stylesheet source.
 * @returns same-length text with comments replaced by spaces.
 */
export const stripComments = stripCssComments
export const rulesOf = styleRules
export const declarationsOf = styleDeclarations

/**
 * Every design-system token a stylesheet references. The three namespaces are
 * the static palette (`--dsw-*`), the runtime preference seams (`--dsh-*`), and
 * the host base tokens (`--ds-*`, defined in `ui-theme/src/styles/base.css`).
 * @param {string} text - stylesheet source, or a single value.
 * @returns {string[]} the referenced names, `--` prefix included.
 */
export function tokenReferencesOf(text) {
  return tokenReferences(text).map((reference) => reference.name)
}

/**
 * The line a source offset falls on.
 * @param {string} css - stylesheet source.
 * @param {number} at - the offset, or `-1` when unknown.
 * @returns {number} the 1-based line number.
 */
function lineOf(css, at) {
  if (at < 0) return 0
  let line = 1
  for (let i = 0; i < at && i < css.length; i += 1) if (css[i] === '\n') line += 1
  return line
}

/**
 * The length in a `border`/`border-width` value, in pixels.
 * @param {string} value - the declaration value.
 * @returns {number | undefined} the pixel width, or `undefined` when the value states none.
 */
function borderWidthOf(value) {
  const match = /(?:^|\s)(\d*\.?\d+)px\b/.exec(value)
  return match === null ? undefined : Number(match[1])
}

/**
 * A rule's border widths, per side.
 *
 * Both the shorthand and the long hands are read, in source order, so a long
 * hand that follows a shorthand overrides it the way the cascade does.
 * @param declarations - the rule's declarations.
 * @returns the width per side, `undefined` where the rule states none.
 */
/**
 * @param {Declarations} declarations
 * @returns {SideWidths} the width per side, `undefined` where the rule states none.
 */
function sideWidthsOf(declarations) {
  /** @type {SideWidths} */
  const widths = {}
  for (const { property, value } of declarations) {
    if (property.endsWith('-color') || property.endsWith('-style')) continue
    const sides = sidesFor(property)
    if (property.endsWith('-width')) {
      const stated = boxValues(value).map(borderWidthOf)
      const expanded = sides.length === 4 ? expandBox(stated) : undefined
      sides.forEach((side, index) => {
        const width = expanded?.[side] ?? stated[index] ?? stated[0]
        if (width !== undefined) widths[side] = width
      })
    } else {
      const width = borderWidthOf(value)
      if (width !== undefined) for (const side of sides) widths[side] = width
    }
  }
  return widths
}

/**
 * Expand a one-to-four value box shorthand to its four sides, as CSS does.
 * @template T
 * @param {Array<T | undefined>} values - the stated values, in source order.
 * @returns {{ top: T | undefined, right: T | undefined, bottom: T | undefined, left: T | undefined }} one value per side; the missing ones stay `undefined`.
 */
function expandBox(values) {
  const [first, second = first, third = first, fourth = second] = values
  return { top: first, right: second, bottom: third, left: fourth }
}

/**
 * The sides a rule paints with a state colour.
 * @param {string} property - the declaration property.
 * @returns {Side[]} the sides, empty when the rule paints no state colour.
 */
function sidesFor(property) {
  if (['border', 'border-color', 'border-width', 'border-style'].includes(property)) return SIDES
  const logical = property.replace(/-(?:width|color|style)$/, '')
  if (LOGICAL_SIDES[logical]) return LOGICAL_SIDES[logical]
  const physical = SIDES.find(
    (side) => property === `border-${side}` || property.startsWith(`border-${side}-`),
  )
  if (physical) return [physical]
  const logicalSide = /** @type {Record<string, Side>} */ ({
    'border-block-start': 'top',
    'border-block-end': 'bottom',
    'border-inline-start': 'left',
    'border-inline-end': 'right',
  })[logical]
  return logicalSide ? [logicalSide] : []
}

/**
 * @param {Declarations} declarations
 * @returns {{ colours: Partial<Record<Side, string>>, solid: Partial<Record<Side, boolean>> }} the colour and solidity per side.
 */
function borderColours(declarations) {
  /** @type {Partial<Record<Side, string>>} */
  const colours = {}
  /** @type {Partial<Record<Side, boolean>>} */
  const solid = {}
  for (const { property, value } of declarations) {
    const sides = sidesFor(property)
    if (sides.length === 0 || /-width$/.test(property)) continue
    if (property.endsWith('-style')) {
      const values = boxValues(value)
      const expanded = sides.length === 4 ? expandBox(values) : undefined
      sides.forEach((side, index) => {
        solid[side] = (expanded?.[side] ?? values[index] ?? values[0]) === 'solid'
      })
      continue
    }
    if (property.endsWith('-color')) {
      const values = boxValues(value)
      const expanded = sides.length === 4 ? expandBox(values) : undefined
      sides.forEach((side, index) => {
        colours[side] = expanded?.[side] ?? values[index] ?? values[0]
      })
    } else {
      for (const side of sides) {
        colours[side] = value
        solid[side] = /(?:^|\s)solid(?:\s|$)/.test(value)
      }
    }
  }
  return { colours, solid }
}

/**
 * @param {Declarations} declarations
 * @returns {Side[]} the sides, empty when the rule paints no state colour.
 */
function stateSidesOf(declarations) {
  const { colours } = borderColours(declarations)
  return SIDES.filter((side) => (colours[side] ?? '').includes('--dsw-alias-state-'))
}

/**
 * The class a selector keys on, without its state suffixes.
 *
 * `.badge[data-tone='success']` and `.badge` are the same box; the variant only
 * restates what the base rule already sized, and a border width has to be read
 * across the pair rather than inside each half.
 * @param selector - one selector of a rule's selector list.
 * @returns the base class, or `undefined` when the selector opens with none.
 */
const baseClassOf = selectorBaseClass
const subjectClassesOf = selectorSubjects

/**
 * Violations of the token contract: a reference to a name the palette does not
 * publish resolves to nothing, so the declaration silently does nothing.
 * @param {StyleSource} source - one stylesheet: its repo-relative path and its source text.
 * @param {TokenPalette} palette - the published `--dsw-*`, `--dsh-*`, and `--ds-*` names.
 * @returns {StyleViolation[]} the violations, empty when every reference resolves.
 */
export function unknownTokenViolations(source, palette) {
  const css = stripComments(source.css)
  const known = new Set([...palette.dsw, ...(palette.dsh ?? []), ...(palette.ds ?? [])])
  const violations = []
  for (const reference of tokenReferences(css)) {
    if (known.has(reference.name)) continue
    violations.push({
      file: source.file,
      line: lineOf(css, reference.at),
      selector: '',
      detail: `var(${reference.name}) names no published token`,
      fix: 'use a name from tests/fixtures/style-tokens.json, or add a --dsh-* seam there with the host code that publishes it',
    })
  }
  return violations
}

/**
 * Violations of the typography ladder: a literal size opts out of the scale and
 * out of the reader's font-size axis.
 * @param {StyleSource} source - one stylesheet.
 * @returns {StyleViolation[]} the violations, empty when every size is a token.
 */
export function bareFontScaleViolations(source) {
  const css = stripComments(source.css)
  const violations = []
  for (const rule of rulesOf(css)) {
    for (const { property, value } of declarationsOf(rule.body)) {
      if (!['font', 'font-size', 'line-height'].includes(property)) continue
      const offScale = valueNodes(value).some(
        (node) =>
          ((node.type === 'Dimension' || node.type === 'Percentage') && Number(node.value) !== 0) ||
          (node.type === 'Identifier' &&
            [
              'xx-small',
              'x-small',
              'small',
              'medium',
              'large',
              'x-large',
              'xx-large',
              'xxx-large',
              'smaller',
              'larger',
            ].includes(node.name.toLowerCase())),
      )
      if (!offScale) continue
      const licensed =
        rule.atRules.some(
          /** @param {string} at */ (at) => mediaRequires(at, 'pointer', 'coarse'),
        ) && value === FOCUS_ZOOM_GUARD.value
      if (licensed) continue
      violations.push({
        file: source.file,
        line: lineOf(css, rule.at),
        selector: rule.selector,
        detail: `${property}: ${value} is off the typography ladder`,
        fix: "use a --dsw-font-* step (it carries the reader's font-size axis)",
      })
    }
  }
  return violations
}

/**
 * Violations of the palette contract: a literal colour cannot follow the dark
 * palette, the high-contrast palette, or a brand override.
 * @param {StyleSource} source - one stylesheet.
 * @returns {StyleViolation[]} the violations, empty when every colour is a token or a mask value.
 */
export function literalColorViolations(source) {
  const css = stripComments(source.css)
  const violations = []
  for (const rule of rulesOf(css)) {
    for (const { property, value } of declarationsOf(rule.body)) {
      const named =
        /color|background|border|shadow|fill|stroke|outline|decoration|filter/.test(property) ||
        property.startsWith('--')
      const literals = colorLiterals(value, named)
      if (literals.length === 0) continue
      const maskCoverage =
        MASK_PROPERTIES.includes(property) &&
        literals.every((literal) => literal === '#000' || literal === '#000000')
      if (maskCoverage) continue
      violations.push({
        file: source.file,
        line: lineOf(css, rule.at),
        selector: rule.selector,
        detail: `${property}: ${value} states a literal colour (${literals.join(', ')})`,
        fix: 'use a --dsw-alias-* colour; mask coverage is the only literal the platform allows',
      })
    }
  }
  return violations
}

/**
 * Violations of the corner-shape pairing: a full-round radius carries a
 * `corner-shape: round`, or the theme's corner cap renders it as a squircle.
 * @param {StyleSource} source - one stylesheet.
 * @returns {StyleViolation[]} the violations, empty when every full round is paired.
 */
export function fullRoundRadiusViolations(source) {
  const css = stripComments(source.css)
  const violations = []
  for (const rule of rulesOf(css)) {
    const declarations = declarationsOf(rule.body)
    const radius = declarations.find(
      /** @param {{ property: string, value: string }} declaration */ ({ property, value }) =>
        (property === 'border-radius' ||
          /^border-(?:top|bottom)-(?:left|right)-radius$/.test(property) ||
          /^border-(?:start|end)-(?:start|end)-radius$/.test(property)) &&
        valueNodes(value).some(
          (node) =>
            (node.type === 'Percentage' && Number(node.value) >= 50) ||
            (node.type === 'Dimension' &&
              ((node.unit.toLowerCase() === 'px' && Number(node.value) >= 999) ||
                (['vh', 'vw', 'vmin', 'vmax', 'svh', 'svw', 'lvh', 'lvw', 'dvh', 'dvw'].includes(
                  node.unit.toLowerCase(),
                ) &&
                  Number(node.value) >= 100))),
        ),
    )
    if (radius === undefined) continue
    const paired = declarations.some(
      /** @param {{ property: string, value: string }} declaration */ ({ property, value }) =>
        property === 'corner-shape' && value === 'round',
    )
    if (paired) continue
    violations.push({
      file: source.file,
      line: lineOf(css, rule.at),
      selector: rule.selector,
      detail: `border-radius: ${radius.value} is a full round with no corner-shape: round`,
      fix: 'pair corner-shape: round with the radius, as corner-shape.css does',
    })
  }
  return violations
}

/**
 * Resolve a rule's inherited border widths against the base classes it
 * qualifies. An attribute variant (`.badge[data-tone]`) resolves exactly; a
 * suffix-composed variant (`.itemRowActive`) resolves against the longest base
 * class name that prefixes it (`.itemRow`), which is the class whose width it
 * restates the colour of.
 * @param {ReadonlyMap<string, SideWidths>} baseWidths - widths keyed by base class name.
 * @param {string} key - the variant's own base class name.
 * @returns {SideWidths} the inherited widths, empty when no base declares one.
 */
function resolveBaseWidths(baseWidths, key) {
  const exact = baseWidths.get(key)
  if (exact !== undefined) return exact
  let best = ''
  /** @type {SideWidths} */
  let widths = {}
  for (const [base, candidate] of baseWidths) {
    if (key.startsWith(base) && base.length > best.length) {
      best = base
      widths = candidate
    }
  }
  return widths
}

/**
 * Violations of the state-border floor: a hairline in a state colour reads as a
 * tint, not a mark, so a state border is at least one pixel.
 *
 * A variant rule usually restates only the colour, taking its width from the
 * class it qualifies; the effective width is therefore resolved across the
 * pair, both for attribute variants and for suffix-composed class names. A
 * variant that neither states nor inherits a full pixel is the failure this
 * catches. Focus rules inherit the base field's width.
 * @param {StyleSource} source - one stylesheet.
 * @returns {StyleViolation[]} the violations, empty when every state border is full weight.
 */
export function stateBorderViolations(source) {
  const css = stripComments(source.css)
  const rules = rulesOf(css)
  const baseWidths = new Map()
  for (const rule of rules) {
    if (rule.selector.includes('[') || rule.selector.includes(':')) continue
    const key = baseClassOf(rule.selector)
    if (key === undefined || baseWidths.has(key)) continue
    const widths = sideWidthsOf(declarationsOf(rule.body))
    if (Object.keys(widths).length > 0) baseWidths.set(key, widths)
  }
  const violations = []
  for (const rule of rules) {
    const declarations = declarationsOf(rule.body)
    const sides = stateSidesOf(declarations)
    if (sides.length === 0) continue
    if (FOCUS_STATE.test(rule.selector)) continue
    const stated = sideWidthsOf(declarations)
    const inherited = resolveBaseWidths(baseWidths, baseClassOf(rule.selector) ?? '')
    const thin = sides.filter((side) => {
      const width = stated[side] ?? inherited[side]
      return width !== undefined && width < STATE_BORDER_FLOOR
    })
    if (thin.length === 0) continue
    violations.push({
      file: source.file,
      line: lineOf(css, rule.at),
      selector: rule.selector,
      detail: `state border on ${thin.join('/')} is a hairline`,
      fix: 'set border-width: 1px alongside the state colour',
    })
  }
  return violations
}

/**
 * The sides a rule leaves painted with a neutral border colour and a solid
 * style, resolving declarations in source order the way the cascade does: a
 * state-coloured longhand after a neutral shorthand takes that side out of the
 * rule, and a colour-only variant keeps the style its base rule stated.
 * @param {Declarations} declarations - the rule's declarations.
 * @returns {Side[]} the sides whose effective colour is a neutral border token and whose effective style is solid.
 */
function neutralSidesOf(declarations) {
  const { colours, solid } = borderColours(declarations)
  return SIDES.filter(
    (side) => solid[side] !== false && (colours[side] ?? '').includes('--dsw-alias-border-'),
  )
}

/**
 * Violations of the neutral hairline rule: a neutral border token is the
 * host's separator, and every divider in the host is drawn at 0.5px. A thicker
 * neutral border reads heavier than the surface it divides, and the difference
 * doubles on a 2x screen.
 *
 * A declared accent (see {@link NEUTRAL_BORDER_ACCENTS}) is skipped: a rail is
 * a mark, not a separator.
 * @param {StyleSource} source - one stylesheet.
 * @returns {StyleViolation[]} the violations, empty when every neutral border is a hairline.
 */
export function neutralBorderViolations(source) {
  const css = stripComments(source.css)
  const rules = rulesOf(css)
  const baseWidths = new Map()
  for (const rule of rules) {
    if (rule.selector.includes('[') || rule.selector.includes(':')) continue
    const key = baseClassOf(rule.selector)
    if (key === undefined || baseWidths.has(key)) continue
    const widths = sideWidthsOf(declarationsOf(rule.body))
    if (Object.keys(widths).length > 0) baseWidths.set(key, widths)
  }
  const violations = []
  for (const rule of rules) {
    const declarations = declarationsOf(rule.body)
    const sides = neutralSidesOf(declarations)
    if (sides.length === 0) continue
    const stated = sideWidthsOf(declarations)
    const inherited = resolveBaseWidths(baseWidths, baseClassOf(rule.selector) ?? '')
    const thick = sides.filter((side) => {
      const width = stated[side] ?? inherited[side]
      return width !== undefined && width > NEUTRAL_BORDER_CEILING
    })
    if (thick.length === 0) continue
    if (
      NEUTRAL_BORDER_ACCENTS.some(
        (accent) => accent.file === source.file && rule.selector.includes(accent.selector),
      )
    ) {
      continue
    }
    violations.push({
      file: source.file,
      line: lineOf(css, rule.at),
      selector: rule.selector,
      detail: `neutral border on ${thick.join('/')} is thicker than a hairline`,
      fix: 'draw a separator at 0.5px; declare a decorative rail in NEUTRAL_BORDER_ACCENTS',
    })
  }
  return violations
}

/**
 * Violations of the hover gate: an ungated `:hover` sticks after a tap on touch
 * hardware.
 * @param {StyleSource} source - one stylesheet.
 * @returns {StyleViolation[]} the violations, empty when every hover rule is gated.
 */
export function hoverMediaViolations(source) {
  const css = stripComments(source.css)
  const violations = []
  for (const rule of rulesOf(css)) {
    if (!selectorHasHover(rule.selector)) continue
    if (rule.atRules.some(/** @param {string} at */ (at) => mediaRequires(at, 'hover', 'hover')))
      continue
    violations.push({
      file: source.file,
      line: lineOf(css, rule.at),
      selector: rule.selector,
      detail: 'hover styling is not gated on a hover-capable pointer',
      fix: 'move it inside @media (hover: hover)',
    })
  }
  return violations
}

/**
 * Violations of the reduced-motion contract: a class that animates a property
 * has to stop animating it when the reader asked for less motion.
 *
 * The reduction is a hand-written list of class names in a second rule, so it
 * rots in exactly the way the audit found: a rule is deleted or renamed and the
 * list keeps naming the class, or a new transition is added and the list never
 * hears about it. Twelve classes were animating with no reduction at all. The
 * host does not hold this line consistently (64 of its sheets declare a
 * transition, 40 reduce it); this repository does, because a list nobody checks
 * is a list that is wrong.
 * @param {StyleSource} source - one stylesheet.
 * @returns {StyleViolation[]} the violations, empty when every animated class is reduced.
 */
export function unreducedMotionViolations(source) {
  const css = stripComments(source.css)
  const animated = new Map()
  const reduced = new Map()
  for (const rule of rulesOf(css)) {
    const declarations = declarationsOf(rule.body)
    const modes = new Map()
    for (const { property, value } of declarations) {
      const kind = property.startsWith('transition')
        ? 'transition'
        : property.startsWith('animation')
          ? 'animation'
          : undefined
      if (kind === undefined) continue
      const disables =
        (property === kind ||
          property === `${kind}-${kind === 'transition' ? 'property' : 'name'}`) &&
        value === 'none'
      modes.set(kind, !disables)
    }
    const subjects = subjectClassesOf(rule.selector)
    const isReduction =
      rule.atRules.length > 0 &&
      rule.atRules.every(
        /** @param {string} at */ (at) => mediaCovers(at, 'prefers-reduced-motion', 'reduce'),
      )
    if (
      rule.atRules.some(
        /** @param {string} at */ (at) =>
          mediaRequires(at, 'prefers-reduced-motion', 'no-preference'),
      )
    )
      continue
    for (const subject of subjects)
      for (const [kind, enabled] of modes) {
        if (isReduction) {
          if (!enabled && reductionSubjects(rule.selector).includes(subject)) {
            const kinds = reduced.get(subject) ?? new Set()
            kinds.add(kind)
            reduced.set(subject, kinds)
          } else if (enabled) reduced.get(subject)?.delete(kind)
        } else if (enabled) {
          const record = animated.get(subject) ?? { at: rule.at, kinds: new Set() }
          record.kinds.add(kind)
          animated.set(subject, record)
        }
      }
  }
  const violations = []
  for (const [subject, { at, kinds }] of animated) {
    const missing = [...kinds].filter((kind) => !reduced.get(subject)?.has(kind))
    if (missing.length === 0) continue
    violations.push({
      file: source.file,
      line: lineOf(css, at),
      selector: subject,
      detail: `${subject}: ${missing.join(' and ')} has no effective reduced-motion disable`,
      fix: 'set transition: none and/or animation: none for this subject under @media (prefers-reduced-motion: reduce)',
    })
  }
  return violations
}

/** Maximum font weight feature CSS may use; emphasis comes from size and ink. */
export const FONT_WEIGHT_CEILING = 500

/**
 * The weight a `font-weight` value or `font` shorthand requests.
 * @param {string} property - `font-weight` or `font`.
 * @param {string} value - the declaration value.
 * @returns the numeric weight, or `undefined` for token or relative values.
 */
function requestedWeight(property, value) {
  const tokens = value.trim().split(/\s+/)
  for (const token of tokens) {
    const lower = token.toLowerCase()
    if (lower === 'bold' || lower === 'bolder') return 700
    if (/^[1-9]00$/.test(lower)) return Number(lower)
    if (lower.includes('var(')) return undefined
  }
  return undefined
}

/**
 * Report font weights above {@link FONT_WEIGHT_CEILING}.
 * @param {StyleSource} source - one stylesheet.
 * @returns {StyleViolation[]} the violations, empty when every weight is at or below the ceiling.
 */
export function fontWeightViolations(source) {
  const css = stripComments(source.css)
  const violations = []
  for (const rule of rulesOf(css)) {
    for (const { property, value } of declarationsOf(rule.body)) {
      if (property !== 'font-weight' && property !== 'font') continue
      const weight = requestedWeight(property, value)
      if (weight === undefined || weight <= FONT_WEIGHT_CEILING) continue
      violations.push({
        file: source.file,
        line: lineOf(css, rule.at),
        selector: rule.selector,
        detail: `${property}: ${value} asks for ${String(weight)}`,
        fix: 'keep feature weights at 500 or below; carry hierarchy with size and ink tokens instead',
      })
    }
  }
  return violations
}

/**
 * Every stylesheet guard, in the order they are reported. Each guard reads one
 * stylesheet; only `unknownTokenViolations` consumes the palette, so the rest
 * accept it and ignore it.
 * @type {ReadonlyArray<(source: StyleSource, palette: TokenPalette) => StyleViolation[]>}
 */
export const STYLE_GUARDS = [
  unknownTokenViolations,
  bareFontScaleViolations,
  fontWeightViolations,
  literalColorViolations,
  fullRoundRadiusViolations,
  stateBorderViolations,
  neutralBorderViolations,
  hoverMediaViolations,
  unreducedMotionViolations,
]

/**
 * Run every guard over every stylesheet.
 * @param {ReadonlyArray<StyleSource>} sources - the stylesheets, as repo-relative path plus source text.
 * @param {TokenPalette} palette - the published token names.
 * @returns {StyleViolation[]} the violations, empty when the stylesheets conform.
 */
export function styleViolations(sources, palette) {
  const violations = []
  for (const guard of STYLE_GUARDS) {
    for (const source of sources) {
      for (const violation of guard(source, palette)) violations.push(violation)
    }
  }
  return violations
}

/**
 * Every stylesheet under the scanned root.
 * @param {string} [base] - the repository root; defaults to the one this script lives in.
 * @returns {StyleSource[]} the sources, sorted by path.
 */
export function styleSources(base = root) {
  /** @param {string} dir @returns {string[]} */
  const walk = (dir) =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) return walk(path)
      return entry.name.endsWith(STYLE_EXTENSION) ? [path] : []
    })
  return walk(join(base, STYLE_ROOT))
    .sort()
    .map((path) => ({
      file: relative(base, path).split('\\').join('/'),
      css: readFileSync(path, 'utf8'),
    }))
}

/**
 * Format one violation as the CLI prints it.
 * @param {StyleViolation} violation - the violation.
 * @returns {string} three indented lines.
 */
export function formatViolation(violation) {
  const where = violation.line === 0 ? violation.file : `${violation.file}:${violation.line}`
  return [
    `  ${where}  ${violation.selector}`.trimEnd(),
    `    ${violation.detail}`,
    `    fix: ${violation.fix}`,
  ].join('\n')
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const palette = JSON.parse(
    readFileSync(join(root, 'tests', 'fixtures', 'style-tokens.json'), 'utf8'),
  )
  const code = /** @type {string[]} */ (readdirSync(join(root, 'src/client'), { recursive: true }))
    .filter((file) => /\.tsx$/.test(String(file)))
    .map((file) => ({
      file: `src/client/${file}`,
      code: readFileSync(join(root, 'src/client', file), 'utf8'),
    }))
  const violations = [
    ...styleViolations(styleSources(), palette),
    ...controlStyleViolations(code, styleSources()),
  ]
  if (violations.length > 0) {
    console.error(`style-guard: ${violations.length} violation(s)`)
    for (const violation of violations) console.error(formatViolation(violation))
    process.exit(1)
  }
  console.log(`style-guard ok: ${styleSources().length} stylesheets`)
}
