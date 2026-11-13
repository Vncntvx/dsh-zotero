<p align="right"><a href="development-notes.md"><b>中文</b></a></p>

# Development notes

## Position and scope

This page records development constraints that future changes must revisit, especially upstream-contract workarounds, upgrade-triggered migrations, and behavior boundaries that are easy to miss in the code and tests. Each entry explains why the constraint exists, when to review it, how to verify it, and how to converge the implementation when the condition changes.

This is not a backlog, design discussion, or general implementation guide. Add an entry only when omitting it could cause a regression, an incorrect migration, or an upstream compatibility break. Do not duplicate ordinary TODOs or material already covered by the architecture docs. Keep the Chinese and English pages synchronized whenever an entry changes.

## Entry requirements

- **Type**: upstream contract / lifecycle / security boundary / compatibility / other development constraint.
- **Status**: active / pending review / retired.
- **Location**: source, test, or configuration path and symbol.
- **Key point**: the behavior, assumption, or boundary future changes must preserve.
- **Trigger**: when to review the point, and the command or evidence to use.
- **Verification**: how the current implementation proves the point.
- **Follow-up**: how to migrate, remove, or update the implementation and tests when the condition changes.

An upstream-contract workaround must also state the current symptom, current workaround, why it is a compromise, and the specific upstream ask. An entry without verification or follow-up is incomplete. Run the `## Upgrade review` procedure on every harness pin bump.

## DN-1: Panel parse completion notices

- **Type**: upstream contract.
- **Status**: active (2026-11-13, pin `0.2.2-rc.2`).
- **Location**: `holdNotice`, `PARSE_NOTICE_WAIT_MS`, and `PARSE_NOTICE_REARM_MS` in `src/enrichment/parse-jobs.ts`.
- **Symptom**: after the library panel parses a PDF, the harness posts a background-job notice to the owning session, and an idle session is woken into a new turn. The notice only asks the model to read the job output; a parse job's output is a receipt (artifactId, character count, bounded preview) with no body or readable path. The model then searches the host filesystem and produces an unsolicited parse report.
- **Current workaround**: the parse job is registered with an `owner` and no `toolCall`. Right after `registry.start` returns, the host holds a `ctx.jobs.wait` and arms a successor every half waiter lifetime; at any settlement at least one waiter is live, the registry marks the settlement `awaited`, and tool-jobs skips the completion notice. The waiters never consume output, cancel the job, or remove the settled record.
- **Why it is a compromise**: it expresses **intent** through an **observation**. `awaited` means "some caller already received the terminal projection", not "the model does not need to know about this job"; the workaround only holds because tool-jobs currently treats `awaited` as already delivered. Any future consumer that reads `awaited` as "the model consumed this" receives a false signal. The remaining assumption is Node's due-timer ordering plus microtask draining between callbacks: a successor always expires before its predecessor, so even when both are overdue the successor registers first; an event loop stalled longer than a wait window has already broken the rest of the process's lifecycle too. The steady state is two waiters and one interval, all cleared at settlement.
- **Upstream ask**: either option retires this workaround.
  1. **Declared intent**: add `notify?: false` (or an equivalent `modelFacing?: false`) to `JobSpec`, carry it to `JobSettledData`, and have tool-jobs honor it before building a notice. This serves any host-initiated job.
  2. **Infer from provenance**: expose `toolCall` on `JobView` (the durable registration already stores it; only the projection is missing) and have tool-jobs announce only jobs created by a tool call. Host-initiated jobs become silent automatically, but host jobs that do want a notice lose it.
- **Review trigger**: after every `npm run harness:pin -- <ver>`, and whenever `npm run harness:check` reports changed upstream artifacts, run the fixed checks: search `node_modules/@deepseek-ai/dsh-jobs/src/types.ts` for `notify`, `silent`, and `modelFacing`; search `node_modules/@deepseek-ai/dsh-jobs/src/view.ts` for `toolCall`; read the `dsh-tool-jobs` delivery conditions to confirm `awaited` is still the only runtime state it skips. When either mechanism appears, move this entry to pending review and migrate in the same pin change.
- **Migration**: delete `holdNotice` and both re-arm constants; switch the parse job to the new declaration (or rely on provenance gating); replace the `awaited` assertions in `tests/host/enrichment-parse-jobs-notice.spec.ts` with the new contract (a panel parse produces no notice, while a `run_in_background` job still does); update `docs/architecture.md`, `docs/architecture.en.md`, and `AGENTS.md`; move this entry to the retired list.
- **Acceptance**: at the current pin, the completed, failed, killed, and cross-window cases all report `awaited === true`, and deleting `holdNotice` makes them fail; after migration, deleting the workaround still keeps a panel parse from waking the model while a model-started background job still receives its completion notice.

## Upgrade review

Every harness pin change walks this page from the top: check whether upstream now provides the requested contract; if it does, migrate and retire the entry in the same change, because a capability that exists while the workaround remains is not an acceptable state. If it does not, update only the pin version and the review date, leaving the workaround untouched.

## Retired entries

None yet. A retired entry keeps its title, retirement date, and replacement mechanism, so the history of why the workaround existed stays traceable.
