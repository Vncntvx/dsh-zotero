/**
 * Source text scanning shared by the repository's mechanical guards.
 *
 * Two guards read TypeScript sources as text rather than as modules: the
 * test-lint focus gate and the harness-state import scan. Both must ignore
 * comments and string bodies, because a documented example of an import is not
 * an import and a commented-out `.only` is not a focused test. Keeping one
 * stripper here is what makes their readings agree.
 * @module scripts/shared/source-scan
 */

/**
 * Blank out comments and string/template bodies while preserving every
 * character's offset, so match positions in the stripped text still map to
 * real line numbers.
 *
 * Regex literals are deliberately not stripped: telling a division from a
 * regex needs a full lexer, a mistake there would blank real code (hiding a
 * violation), and a regex body containing `.only(`/`.skip(` does not occur in
 * this suite.
 *
 * `blankStrings = false` keeps string bodies intact. The upstream-source
 * import guard needs both readings: comments removed so a documented example
 * does not count as a dependency, and string bodies still present so the
 * module specifier can be named. Comparing the two readings at each match
 * position is what distinguishes a real import from a string fixture.
 * @param source - the file content.
 * @param blankStrings - whether to blank string and template bodies too.
 * @returns same-length text with comments (and optionally strings) blanked.
 */
export function stripCommentsAndStrings(source, blankStrings = true) {
  const out = source.split('')
  const n = source.length
  let i = 0
  while (i < n) {
    const ch = source[i]
    const next = i + 1 < n ? source[i + 1] : ''
    if (ch === '/' && next === '/') {
      while (i < n && source[i] !== '\n') {
        out[i] = ' '
        i += 1
      }
      continue
    }
    if (ch === '/' && next === '*') {
      out[i] = ' '
      out[i + 1] = ' '
      i += 2
      while (i < n) {
        if (source[i] === '*' && source[i + 1] === '/') {
          out[i] = ' '
          out[i + 1] = ' '
          i += 2
          break
        }
        if (source[i] !== '\n') out[i] = ' '
        i += 1
      }
      continue
    }
    if (blankStrings && (ch === '"' || ch === "'" || ch === '`')) {
      const quote = ch
      i += 1
      while (i < n) {
        if (source[i] === '\\') {
          out[i] = ' '
          if (source[i + 1] !== undefined && source[i + 1] !== '\n') out[i + 1] = ' '
          i += 2
          continue
        }
        if (source[i] === quote) {
          out[i] = ' '
          i += 1
          break
        }
        if (source[i] !== '\n') out[i] = ' '
        i += 1
      }
      continue
    }
    i += 1
  }
  return out.join('')
}
