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
 * 5. **State borders are one pixel.** A hairline (0.5px) border in a state
 *    colour reads as a tint rather than a mark: it was invisible at 1× and
 *    mushy at 2×. State borders carry the full pixel.
 * 6. **Hover is capability-gated.** An ungated `:hover` sticks after a tap on
 *    touch hardware, leaving the last-tapped control in its hover dress.
 * 7. **Motion is reducible.** A reader who asked for less motion gets no
 *    transition. The reduction is a hand-written list of class names in a
 *    second rule, which is exactly the kind of list that goes stale: the audit
 *    that produced this guard found eight entries naming rules that no longer
 *    animate, and thirteen classes animating with no entry at all.
 *
 * The predicates below are exported and driven by `tests/unit/style-guard` so
 * the guards cannot decay: a parser that stopped matching the form its
 * docstring names would otherwise fail the suite green.
 * @module scripts/style-guard
 */

import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

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

/** Border sides, in the order a shorthand writes them. */
const SIDES = ['top', 'right', 'bottom', 'left']

/** A border thinner than this reads as a tint instead of a mark. */
const STATE_BORDER_FLOOR = 1

/**
 * Blank out comment bodies while preserving every offset, so a match position
 * still maps to its real line.
 * @param css - stylesheet source.
 * @returns same-length text with comments replaced by spaces.
 */
export function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, ' '))
}

/**
 * The index of the `}` closing the block opened at `open`.
 * @param css - stylesheet source.
 * @param open - index of the `{`.
 * @returns index of the matching `}`, or the text length when unbalanced.
 */
function closingBraceOf(css, open) {
  let depth = 0
  for (let i = open; i < css.length; i += 1) {
    if (css[i] === '{') depth += 1
    else if (css[i] === '}') {
      depth -= 1
      if (depth === 0) return i
    }
  }
  return css.length
}

/**
 * Every style rule in a stylesheet, flattening nested at-rules.
 *
 * A rule knows the at-rule preludes it sits under, which is what the hover and
 * focus-zoom exceptions are written against. At-rule blocks are recursed into,
 * so a rule inside `@media` is reported like any other; `@keyframes` steps fall
 * out as selectors (`from`, `40%`), and no guard reads them.
 * @param css - stylesheet source, comments already stripped.
 * @returns the rules, in source order.
 */
export function rulesOf(css) {
  const rules = []
  const walk = (start, end, atRules) => {
    let buffer = ''
    let preludeAt = -1
    let i = start
    while (i < end) {
      const char = css[i]
      if (char === '}') {
        buffer = ''
        preludeAt = -1
        i += 1
        continue
      }
      if (char === '{') {
        const close = closingBraceOf(css, i)
        const prelude = buffer.trim()
        if (prelude.startsWith('@')) walk(i + 1, Math.min(close, end), [...atRules, prelude])
        else
          rules.push({ selector: prelude, body: css.slice(i + 1, close), atRules, at: preludeAt })
        buffer = ''
        preludeAt = -1
        i = close + 1
        continue
      }
      if (preludeAt === -1) {
        if (/\s/.test(char)) {
          i += 1
          continue
        }
        preludeAt = i
      }
      buffer += char
      i += 1
    }
  }
  walk(0, css.length, [])
  return rules
}

/**
 * The declarations of one rule body.
 * @param body - the text between a rule's braces.
 * @returns property/value pairs, property lower-cased, value trimmed.
 */
export function declarationsOf(body) {
  const declarations = []
  const push = (chunk) => {
    const colon = chunk.indexOf(':')
    if (colon === -1) return
    const property = chunk.slice(0, colon).trim().toLowerCase()
    const value = chunk.slice(colon + 1).trim()
    if (property === '' || value === '') return
    declarations.push({ property, value })
  }
  let buffer = ''
  for (const char of body) {
    if (char === ';') {
      push(buffer)
      buffer = ''
    } else buffer += char
  }
  push(buffer)
  return declarations
}

/**
 * Every design-system token a stylesheet references.
 * @param text - stylesheet source, or a single value.
 * @returns the referenced names, `--` prefix included.
 */
export function tokenReferencesOf(text) {
  return [...text.matchAll(/var\(\s*(--(?:dsw|dsh)-[a-z0-9-]+)/g)].map((match) => match[1])
}

/**
 * The line a source offset falls on.
 * @param css - stylesheet source.
 * @param at - the offset, or `-1` when unknown.
 * @returns the 1-based line number.
 */
function lineOf(css, at) {
  if (at < 0) return 0
  let line = 1
  for (let i = 0; i < at && i < css.length; i += 1) if (css[i] === '\n') line += 1
  return line
}

/**
 * The length in a `border`/`border-width` value, in pixels.
 * @param value - the declaration value.
 * @returns the pixel width, or `undefined` when the value states none.
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
function sideWidthsOf(declarations) {
  const widths = {}
  for (const { property, value } of declarations) {
    if (property === 'border') {
      const width = borderWidthOf(value)
      if (width !== undefined) for (const side of SIDES) widths[side] = width
      continue
    }
    if (property === 'border-width') {
      const stated = expandBox(value.split(/\s+/).map((part) => borderWidthOf(part)))
      for (const side of SIDES) if (stated[side] !== undefined) widths[side] = stated[side]
      continue
    }
    const side = SIDES.find(
      (name) => property === `border-${name}` || property === `border-${name}-width`,
    )
    const width = side === undefined ? undefined : borderWidthOf(value)
    if (side !== undefined && width !== undefined) widths[side] = width
  }
  return widths
}

/**
 * Expand a one-to-four value box shorthand to its four sides, as CSS does.
 * @param values - the stated values, in source order.
 * @returns one value per side; the missing ones stay `undefined`.
 */
function expandBox(values) {
  const [first, second = first, third = first, fourth = second] = values
  return { top: first, right: second, bottom: third, left: fourth }
}

/**
 * The sides a rule paints with a state colour.
 * @param declarations - the rule's declarations.
 * @returns the sides, empty when the rule paints no state colour.
 */
function stateSidesOf(declarations) {
  const sides = new Set()
  for (const { property, value } of declarations) {
    if (!value.includes('--dsw-alias-state-')) continue
    if (property === 'border' || property === 'border-color')
      for (const side of SIDES) sides.add(side)
    else {
      const side = SIDES.find(
        (name) => property === `border-${name}` || property === `border-${name}-color`,
      )
      if (side !== undefined) sides.add(side)
    }
  }
  return [...sides]
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
function baseClassOf(selector) {
  const match = /^\.([A-Za-z0-9_-]+)/.exec(selector.trim())
  return match === null ? undefined : `.${match[1]}`
}

/**
 * The classes a rule actually styles: the last compound of each selector.
 *
 * `.row:hover .icon` animates `.icon`, not `.row`, so the subject — not the
 * qualifying ancestor — is what the motion guard holds against the reduction
 * list. Pseudo-classes and their arguments are stripped before the names are
 * read, so `.link:not(.x)` yields `.link`.
 * @param selector - a rule's selector list.
 * @returns the subject classes, de-duplicated, in source order.
 */
function subjectClassesOf(selector) {
  const subjects = new Set()
  for (const one of selector.split(',')) {
    const compound =
      one
        .trim()
        .split(/[\s>+~]+/)
        .filter(Boolean)
        .pop() ?? ''
    const bare = compound.replace(/::?[A-Za-z-]+(\([^)]*\))?/g, '')
    for (const match of bare.matchAll(/\.([A-Za-z_][A-Za-z0-9_-]*)/g)) subjects.add(`.${match[1]}`)
  }
  return [...subjects]
}

/**
 * Violations of the token contract: a reference to a name the palette does not
 * publish resolves to nothing, so the declaration silently does nothing.
 * @param source - one stylesheet: its repo-relative path and its source text.
 * @param palette - the published `--dsw-*` and `--dsh-*` names.
 * @returns the violations, empty when every reference resolves.
 */
export function unknownTokenViolations(source, palette) {
  const css = stripComments(source.css)
  const known = new Set([...palette.dsw, ...palette.dsh])
  const violations = []
  for (const match of css.matchAll(/var\(\s*(--(?:dsw|dsh)-[a-z0-9-]+)/g)) {
    if (known.has(match[1])) continue
    violations.push({
      file: source.file,
      line: lineOf(css, match.index),
      selector: '',
      detail: `var(${match[1]}) names no published token`,
      fix: 'use a name from tests/fixtures/style-tokens.json, or add a --dsh-* seam there with the host code that publishes it',
    })
  }
  return violations
}

/**
 * Violations of the typography ladder: a literal size opts out of the scale and
 * out of the reader's font-size axis.
 * @param source - one stylesheet.
 * @returns the violations, empty when every size is a token.
 */
export function bareFontScaleViolations(source) {
  const css = stripComments(source.css)
  const violations = []
  for (const rule of rulesOf(css)) {
    for (const { property, value } of declarationsOf(rule.body)) {
      if (!['font', 'font-size', 'line-height'].includes(property)) continue
      if (!/\d*\.?\d+px/.test(value) || value.includes('var(')) continue
      const licensed =
        rule.atRules.some((at) => at.includes(FOCUS_ZOOM_GUARD.query)) &&
        value === FOCUS_ZOOM_GUARD.value
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
 * @param source - one stylesheet.
 * @returns the violations, empty when every colour is a token or a mask value.
 */
export function literalColorViolations(source) {
  const css = stripComments(source.css)
  const violations = []
  for (const rule of rulesOf(css)) {
    for (const { property, value } of declarationsOf(rule.body)) {
      const literals = [...value.matchAll(/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/g)].map(
        (match) => match[0],
      )
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
 * @param source - one stylesheet.
 * @returns the violations, empty when every full round is paired.
 */
export function fullRoundRadiusViolations(source) {
  const css = stripComments(source.css)
  const violations = []
  for (const rule of rulesOf(css)) {
    const declarations = declarationsOf(rule.body)
    const radius = declarations.find(({ property }) => property === 'border-radius')
    if (radius === undefined) continue
    const fullRound = /\b(?:50|100)%/.test(radius.value) || /\b9{3,}(?:\.\d+)?px/.test(radius.value)
    if (!fullRound) continue
    const paired = declarations.some(
      ({ property, value }) => property === 'corner-shape' && value.includes('round'),
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
 * Violations of the state-border floor: a hairline in a state colour reads as a
 * tint, not a mark, so a state border is at least one pixel.
 *
 * A variant rule usually restates only the colour, taking its width from the
 * class it qualifies; the effective width is therefore resolved across the
 * pair, and a variant that neither states nor inherits a full pixel is the
 * failure this catches.
 * @param source - one stylesheet.
 * @returns the violations, empty when every state border is full weight.
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
    const stated = sideWidthsOf(declarations)
    const inherited = baseWidths.get(baseClassOf(rule.selector) ?? '') ?? {}
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
 * Violations of the hover gate: an ungated `:hover` sticks after a tap on touch
 * hardware.
 * @param source - one stylesheet.
 * @returns the violations, empty when every hover rule is gated.
 */
export function hoverMediaViolations(source) {
  const css = stripComments(source.css)
  const violations = []
  for (const rule of rulesOf(css)) {
    if (!rule.selector.includes(':hover')) continue
    if (rule.atRules.some((at) => /hover\s*:\s*hover/.test(at))) continue
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
 * @param source - one stylesheet.
 * @returns the violations, empty when every animated class is reduced.
 */
export function unreducedMotionViolations(source) {
  const css = stripComments(source.css)
  const animated = new Map()
  const reduced = new Set()
  for (const rule of rulesOf(css)) {
    const subjects = subjectClassesOf(rule.selector)
    if (rule.atRules.some((at) => /prefers-reduced-motion\s*:\s*reduce/.test(at))) {
      for (const subject of subjects) reduced.add(subject)
      continue
    }
    const animates = declarationsOf(rule.body).some(
      ({ property }) => property === 'transition' || property === 'transition-property',
    )
    if (!animates) continue
    for (const subject of subjects) if (!animated.has(subject)) animated.set(subject, rule.at)
  }
  const violations = []
  for (const [subject, at] of animated) {
    if (reduced.has(subject)) continue
    violations.push({
      file: source.file,
      line: lineOf(css, at),
      selector: subject,
      detail: `${subject} animates with no prefers-reduced-motion reduction`,
      fix: 'add it to a `@media (prefers-reduced-motion: reduce)` block in this sheet with `transition: none`',
    })
  }
  return violations
}

/** Every stylesheet guard, in the order they are reported. */
export const STYLE_GUARDS = [
  unknownTokenViolations,
  bareFontScaleViolations,
  literalColorViolations,
  fullRoundRadiusViolations,
  stateBorderViolations,
  hoverMediaViolations,
  unreducedMotionViolations,
]

/**
 * Run every guard over every stylesheet.
 * @param sources - the stylesheets, as repo-relative path plus source text.
 * @param palette - the published token names.
 * @returns the violations, empty when the stylesheets conform.
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
 * @param base - the repository root; defaults to the one this script lives in.
 * @returns the sources, sorted by path.
 */
export function styleSources(base = root) {
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
 * @param violation - the violation.
 * @returns three indented lines.
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
  const violations = styleViolations(styleSources(), palette)
  if (violations.length > 0) {
    console.error(`style-guard: ${violations.length} violation(s)`)
    for (const violation of violations) console.error(formatViolation(violation))
    process.exit(1)
  }
  console.log(`style-guard ok: ${styleSources().length} stylesheets`)
}
