export function registryVersionsOf(
  packument: unknown,
  range: string,
  constraint?: string,
): { wanted: string; latest: string; eligible: string; outsideRange: boolean }
