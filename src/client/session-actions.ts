import type { SessionSnapshot } from '@deepseek-ai/dsh-api-session-controller/client'

/** An open ordinary conversation can resolve an Agent between turns. */
export function canUseSessionActions(session: SessionSnapshot): boolean {
  return (
    !session.removed &&
    session.subagent === null &&
    (session.running || (session.openState === 'open' && !session.blank))
  )
}
