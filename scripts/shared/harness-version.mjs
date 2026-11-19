/** Derived compatibility bounds shared by manifest and installation examples. */
/**
 * The exclusive upper bound of the tested line: the next minor after the pin's
 * minor. `engines.dsh` carries it so an install cannot land on a harness
 * generation this plugin was never built or tested against; the browser bundle
 * mirrors the pin's client dependencies verbatim, so the next minor is a
 * different client contract even when the host itself starts fine.
 * @param {string} pin - the exact pin.
 * @returns {string | undefined} the bound, or undefined when the pin is unreadable.
 */
export function harnessUpperBoundOf(pin) {
  const match = /^(\d+)\.(\d+)\.\d+/.exec(pin)
  if (match === null) return undefined
  return `${match[1]}.${Number(match[2]) + 1}.0`
}
