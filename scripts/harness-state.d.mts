/** Type surface for the harness-state CLI's pure helpers (unit-tested). */

export declare function versionMapBounds(lines: string[]): { start: number; end: number }

export declare function retargetProse(source: string, previous: string, next: string): string

export declare function checkVersionMap(
  path: string,
  source: string,
  packageVersion: string,
  pin: string,
): string[]
