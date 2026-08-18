/**
 * The installed `@types/node` no longer declares the synchronous DNS
 * variants, although `dns.lookupSync` remains a documented runtime API.
 * This ambient declaration restores the narrow shape `config.ts` needs. It
 * is also part of the client typecheck (see `tsconfig.client.json`), whose
 * `types: []` excludes `@types/node` entirely but still type-resolves
 * `config.ts` through its type-only importers.
 */
declare module 'node:dns' {
  export function lookupSync(
    hostname: string,
    options: { all: true },
  ): { address: string; family: number }[]
}
