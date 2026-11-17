export declare function declarationDependencyProblems(
  sources: readonly { readonly path: string; readonly source: string }[],
  manifest: {
    readonly name: string
    readonly dependencies?: Record<string, string>
    readonly optionalDependencies?: Record<string, string>
    readonly peerDependencies?: Record<string, string>
  },
): string[]
