/** Scripted MinerU transport with public DNS and no sockets. @module tests/host/support/mineru-transport */
import { MineruClient } from '../../../src/enrichment/transport.ts'

type FetchCall = { url: string; init: RequestInit }
type AnsweredAddress = { address: string; family: 4 | 6 }

export function clientOf(
  fetchImpl: (url: string, init?: RequestInit) => Promise<Response>,
  resolver: (hostname: string) => Promise<AnsweredAddress[]> = async () => [
    { address: '93.184.216.34', family: 4 },
  ],
) {
  const calls: FetchCall[] = []
  /** The address set each attempt pinned into its dispatcher. */
  const pinned: AnsweredAddress[][] = []
  const client = new MineruClient({
    resolver: async (hostname) => await resolver(hostname),
    dispatcher: (addresses) => {
      pinned.push(addresses.map(({ address, family }) => ({ address, family })))
      return { dispatcher: {} as never, close: async () => {} }
    },
    fetch: async (url, init) => {
      calls.push({ url, init: init ?? {} })
      return await fetchImpl(url, init)
    },
  })
  return { client, calls, pinned }
}

export function headersOf(init: RequestInit): Record<string, string> {
  return (init.headers ?? {}) as Record<string, string>
}
