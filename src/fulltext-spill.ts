/** Pure delivery callback shared by provider contracts and tool composition. */
/**
 * Persist one bounded whole document so a model can read it through a single
 * handle instead of walking every window. The tool layer supplies it from the
 * host spill store; the domain only decides when a document is large enough
 * to be worth one. Returning undefined means no store was available, which
 * leaves the window chain as the only read path.
 */
export type FulltextSpillSink = (
  text: string,
) => Promise<
  { readonly locator: string; readonly bytes: number; readonly retrievalHint: string } | undefined
>
