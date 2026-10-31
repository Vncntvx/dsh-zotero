/**
 * Types for `scripts/style-guard.mjs`, driven by `tests/unit/style-guard`.
 * @module dsh-zotero/scripts/style-guard
 */

/** One stylesheet: the repo-relative path a violation is reported at, and its source text. */
export interface StyleSource {
  /** Repo-relative path, `/`-separated. */
  readonly file: string
  /** The stylesheet source, comments included. */
  readonly css: string
}

/** The published token names a reference may resolve to. */
export interface TokenPalette {
  /** `--dsw-*` names the theme sheets define. */
  readonly dsw: readonly string[]
  /** `--dsh-*` seams the host publishes at runtime. */
  readonly dsh: readonly string[]
}

/** One style rule, flattened out of any at-rules around it. */
export interface StyleRule {
  /** The selector list as written. */
  readonly selector: string
  /** The text between the rule's braces. */
  readonly body: string
  /** The at-rule preludes the rule sits under, outermost first. */
  readonly atRules: readonly string[]
  /** Offset of the selector's first character, `-1` when unknown. */
  readonly at: number
}

/** One declaration of a rule body. */
export interface StyleDeclaration {
  /** Lower-cased property name. */
  readonly property: string
  /** Trimmed value. */
  readonly value: string
}

/** One rule broken by one guard. */
export interface StyleViolation {
  /** Repo-relative path of the offending stylesheet. */
  readonly file: string
  /** 1-based line, `0` when the offset is unknown. */
  readonly line: number
  /** The offending selector, empty when the violation is not tied to a rule. */
  readonly selector: string
  /** What is wrong, in one line. */
  readonly detail: string
  /** What to write instead. */
  readonly fix: string
}

/** One guard: a stylesheet and the palette, out come the violations. */
export type StyleGuard = (source: StyleSource, palette: TokenPalette) => StyleViolation[]

/** Directory scanned for stylesheets, relative to the repository root. */
export declare const STYLE_ROOT: string

/** Extension the guard reads. */
export declare const STYLE_EXTENSION: string

/** The one literal `font-size` the ladder allows, and the query that licenses it. */
export declare const FOCUS_ZOOM_GUARD: { readonly query: string; readonly value: string }

/** Properties whose literal `#000` is a coverage value rather than a colour. */
export declare const MASK_PROPERTIES: readonly string[]

/**
 * Blank out comment bodies while preserving every offset.
 * @param css - stylesheet source.
 * @returns same-length text with comments replaced by spaces.
 */
export declare function stripComments(css: string): string

/**
 * Every style rule in a stylesheet, flattening nested at-rules.
 * @param css - stylesheet source, comments already stripped.
 * @returns the rules, in source order.
 */
export declare function rulesOf(css: string): StyleRule[]

/**
 * The declarations of one rule body.
 * @param body - the text between a rule's braces.
 * @returns property/value pairs.
 */
export declare function declarationsOf(body: string): StyleDeclaration[]

/**
 * Every design-system token a stylesheet references.
 * @param text - stylesheet source, or a single value.
 * @returns the referenced names, `--` prefix included.
 */
export declare function tokenReferencesOf(text: string): string[]

/** Token references that name no published token. */
export declare const unknownTokenViolations: StyleGuard

/** Literal `font-size`/`line-height` values off the typography ladder. */
export declare const bareFontScaleViolations: StyleGuard

/** Literal colours outside the palette, mask coverage excepted. */
export declare const literalColorViolations: StyleGuard

/** Full-round radii with no paired `corner-shape: round`. */
export declare const fullRoundRadiusViolations: StyleGuard

/** State-coloured borders thinner than one pixel. */
export declare const stateBorderViolations: StyleGuard

/** `:hover` rules outside `@media (hover: hover)`. */
export declare const hoverMediaViolations: StyleGuard

/** Classes that animate with no `prefers-reduced-motion` reduction in their sheet. */
export declare const unreducedMotionViolations: StyleGuard

/** Every stylesheet guard, in the order they are reported. */
export declare const STYLE_GUARDS: readonly StyleGuard[]

/**
 * Run every guard over every stylesheet.
 * @param sources - the stylesheets.
 * @param palette - the published token names.
 * @returns the violations, empty when the stylesheets conform.
 */
export declare function styleViolations(
  sources: readonly StyleSource[],
  palette: TokenPalette,
): StyleViolation[]

/**
 * Every stylesheet under the scanned root.
 * @param base - the repository root; defaults to the one the script lives in.
 * @returns the sources, sorted by path.
 */
export declare function styleSources(base?: string): StyleSource[]

/**
 * Format one violation as the CLI prints it.
 * @param violation - the violation.
 * @returns three indented lines.
 */
export declare function formatViolation(violation: StyleViolation): string
