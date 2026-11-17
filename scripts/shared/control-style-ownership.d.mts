import type { StyleViolation } from '../style-guard.mjs'
export declare function controlStyleViolations(
  codeSources: readonly { readonly file: string; readonly code: string }[],
  styles: readonly { readonly file: string; readonly css: string }[],
): StyleViolation[]
