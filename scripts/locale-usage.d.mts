export function clientLocaleSources(root: string): [path: string, source: string][]
export function unusedLocaleKeys(
  keys: readonly string[],
  sources: readonly (readonly [path: string, source: string])[],
): string[]
