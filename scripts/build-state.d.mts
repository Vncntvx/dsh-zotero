export interface BuildState {
  readonly version: number
  readonly commit: string
  readonly mode: string
  readonly toolchain: Readonly<Record<string, string>>
  readonly inputs: { readonly files: Readonly<Record<string, string>>; readonly digest: string }
  readonly outputs: { readonly files: Readonly<Record<string, string>>; readonly digest: string }
}
export function writeBuildState(base?: string): BuildState
export function assertBuildFresh(base?: string): BuildState
