/**
 * Slot standard props for the `/zotero` command card under test.
 *
 * The card is a `conversation.chat.commandview` occupant, so its real props are
 * `PropsRuntime<...>`: the upstream merges add a Session kit (`useSession`,
 * `sessionId`, `useProjection`, …) that a unit test has no reason to build by
 * hand. This module supplies exactly the members the card reads, and lets a
 * case override the projected snapshot it resolves.
 * @module tests/client/helpers/command-card-props
 */

import type { ZoteroStatusView } from '../../../src/contract.ts'
import type { ZoteroCommandCardProps } from '../../../src/client/ZoteroCommandCard.tsx'

/** The standard props the card reads; everything else is absent by design. */
export interface CommandCardStandardProps {
  /** Projected `zoteroStatus` value, or null when the session logged none. */
  readonly projected?: ZoteroStatusView | null
  /**
   * Whether the composition carries a projection registry at all. When false,
   * `useProjection` answers `undefined` — the upstream's "capability absent"
   * answer — instead of a null snapshot. Defaults to true.
   */
  readonly projectionCapability?: boolean
}

/**
 * The card's own props: its owner props plus the injected face. Everything the
 * upstream standard kit adds is supplied by {@link withStandardProps}.
 */
export type CommandCardBaseProps = Pick<ZoteroCommandCardProps, 'node' | 't' | 'probe'>

/**
 * Build the props one card case renders with.
 * @param base - the card's own props (node, t, probe).
 * @param standard - the standard-prop values the case wants.
 * @returns the props, cast to the raw runtime surface.
 */
export function withStandardProps(
  base: CommandCardBaseProps,
  standard: CommandCardStandardProps = {},
): ZoteroCommandCardProps {
  const capable = standard.projectionCapability ?? true
  const props = {
    ...base,
    sessionId: 'session-1',
    useSession: (sel: (snap: { sessionId: string }) => unknown) => sel({ sessionId: 'session-1' }),
    useProjection: (key: string) => {
      if (key !== 'zoteroStatus') return undefined
      // Capability absent is a different answer from "no snapshot recorded":
      // the registry itself is missing, so there is nothing to read.
      if (!capable) return undefined
      return standard.projected ?? null
    },
    useAccess: () => false,
  }
  return props as unknown as ZoteroCommandCardProps
}
