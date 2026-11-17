/** Type surface for harness package enumerator and root resolver. */

export declare function resolveHarnessRoot(root: string): string

export declare function collectHarnessPackages(harnessRoot: string): Map<string, string>

/** Sorted, unique client dependency declarations from one immutable harness tag. */
export declare function mirroredDeclarationsOf(
  run: (args: string[]) => string,
  tag: string,
): Record<string, string[]>
