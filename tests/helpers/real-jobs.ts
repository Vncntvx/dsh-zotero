/**
 * The real background-job registry for one spec.
 *
 * `LocalJobRegistry` is the store the plugin runs against, and its admission
 * has two seams a bare `Context` lacks: an owner session must resolve to a
 * live agent (`ctx.agents`), and some attached controller must serve that
 * owner. The former test double replaced the registry wholesale, so its
 * `wait` could ignore the caller and its `kill` could answer a `JobView` where
 * the contract says `'requested' | 'already-finished'` — a spec built on it
 * proved nothing about the real contract.
 *
 * This helper composes the real registry with exactly those two seams. Owner
 * agents are the harness's own `stubAgent` shape (a plugin fiber per agent, so
 * the registry can attach its owner cleanup), and one controller is attached
 * from the root context, which serves every owner.
 * @module tests/helpers/real-jobs
 */

import { Context, Service, type Fiber } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { JobId } from '@deepseek-ai/dsh-jobs'
import type { JobRegistry, JobView } from '@deepseek-ai/dsh-jobs'
import LocalJobRegistry from '@deepseek-ai/dsh-jobs-local'
import { SessionId } from '@deepseek-ai/dsh-session'

/** One composed registry plus the seams a spec reaches through. */
export interface RealJobs {
  readonly ctx: Context
  /** The real registry, typed as the plugin sees it. */
  readonly registry: JobRegistry
  /** The fiber that provides `ctx.jobs`, when this call mounted it. */
  readonly fiber?: Fiber
  /** The live agent the given owner session resolves to, created on first use. */
  agentOf(sessionId: string): Agent
  /** Wait for one job to settle, through the registry's own contract. */
  settled(id: JobId, sessionId?: string): Promise<JobView>
  dispose(): Promise<void>
}

/**
 * Compose the real registry on an existing context (a host lane, say), with a
 * live agent per owner and one controller. The context stays the caller's:
 * `dispose` stops the live jobs and leaves the lane to tear itself down.
 * @param ctx - the context to compose on.
 * @returns the registry plus the seams a spec reaches through.
 */
export async function composeRealJobs(ctx: Context): Promise<RealJobs> {
  // One composition per context: a spec may call this from several cases over
  // the same lane.
  let fiber: Fiber | undefined
  if (ctx.get('jobs') === undefined) {
    await ctx.plugin(StubAgents)
    fiber = await ctx.plugin(LocalJobRegistry, {})
    // A controller attached from the root context lands in the global layer
    // and serves every owner, which is what a host composition's own controls
    // do.
    ctx.jobs.attachController('spec')
  }
  const agents = ctx.get('agents') as unknown as StubAgents

  return {
    ctx,
    registry: ctx.jobs,
    ...(fiber === undefined ? {} : { fiber }),
    agentOf: (sessionId) => agents.get(SessionId(sessionId))!,
    settled: async (id, sessionId) =>
      await ctx.jobs.wait(id, 5_000, sessionId === undefined ? undefined : SessionId(sessionId)),
    // Teardown awaits every job's settlement, so a producer that never finishes
    // would hang it: the live ones are stopped first.
    dispose: async () => {
      for (const caller of [undefined, ...agents.liveIds()]) {
        for (const view of ctx.jobs.list(caller)) {
          if (view.status === 'running' || view.status === 'stopping') {
            ctx.jobs.kill(view.id, caller)
          }
        }
      }
    },
  }
}

/**
 * The agent seam the registry's admission reads. It answers a live agent for
 * any session a spec names, created on first use; `list` keeps the subagent
 * guard's composition walk working.
 */
class StubAgents extends Service {
  private readonly byId = new Map<SessionId, Agent>()

  constructor(private readonly host: Context) {
    super(host, 'agents')
  }

  get(id: SessionId): Agent | undefined {
    const existing = this.byId.get(id)
    if (existing !== undefined) return existing
    // One fiber per agent: the registry records its owner cleanup as an effect
    // of that scope and disposes the agent's jobs with it.
    const fiber = this.host.plugin(() => {})
    const agent = { id, session: { id }, ctx: fiber.ctx } as unknown as Agent
    this.byId.set(id, agent)
    return agent
  }

  list(): Agent[] {
    return [...this.byId.values()]
  }

  /** The owner ids this stub has answered, for teardown sweeps. */
  liveIds(): SessionId[] {
    return [...this.byId.keys()]
  }
}

/** Mount the real registry on a context of its own, disposed with the spec. */
export async function mountRealJobs(): Promise<RealJobs> {
  const ctx = new Context()
  const jobs = await composeRealJobs(ctx)
  return {
    ...jobs,
    dispose: async () => {
      await jobs.dispose()
      await ctx.fiber.dispose()
    },
  }
}
