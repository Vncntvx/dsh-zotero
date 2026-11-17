export declare function pinnedFileOf(
  run: (args: string[]) => string,
  tag: string,
  path: string,
):
  | { readonly kind: 'file'; readonly source: string }
  | { readonly kind: 'missing-tag' | 'missing-file'; readonly message: string }
