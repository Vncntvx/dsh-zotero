/** Explicit browser navigation accepts web URLs without embedded credentials. */
export function webUrlOf(value: string | undefined): string | undefined {
  if (value === undefined) return undefined
  try {
    const url = new URL(value)
    if (
      (url.protocol !== 'http:' && url.protocol !== 'https:') ||
      url.username !== '' ||
      url.password !== ''
    )
      return undefined
    return url.href
  } catch {
    return undefined
  }
}
