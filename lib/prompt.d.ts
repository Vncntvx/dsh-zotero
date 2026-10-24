/**
 * The model-facing Zotero policy section: when the tools may run, how the
 * tools compose into a retrieval workflow, the honesty rules (evidence match
 * fails closed, no invented page locators, absence is not evidence), and the
 * untrusted-data rule that keeps library content from acting as instructions.
 * Parameter-level detail lives in each tool's own description; this section
 * keeps only the cross-tool decisions, so the fixed per-turn cost stays small
 * and the two surfaces cannot drift.
 * The section text is a provider evaluated at every assembly, so the tool
 * cap values it states always track the live config, and the model never has
 * to guess a limit the plugin will reject.
 * Registered once, after the first-party per-tool sections.
 * @module dsh-zotero/prompt
 */
import type { Context } from '@deepseek-ai/cordis';
import type { ResolvedConfig } from './config.js';
/**
 * The next first-party placement above the guidance band: the order ceiling
 * this section computes its placement from.
 */
export declare const ZOTERO_PROMPT_CEILING: "TOOL_COMPUTER_USE";
/**
 * The placement the policy trails: the tail of the first-party tool-guidance
 * band. Kept for specs asserting the section sits strictly above it.
 */
export declare const ZOTERO_PROMPT_FLOOR: "TOOL_REPORT";
/**
 * Headroom below the next first-party placement: half the gap between
 * {@link ZOTERO_PROMPT_FLOOR} (2900) and {@link ZOTERO_PROMPT_CEILING} (3000),
 * so an insertion anywhere above cannot collide with this section.
 *
 * The order derives from the **upper bound** ({@link ZOTERO_PROMPT_CEILING}) and
 * not from {@link ZOTERO_PROMPT_FLOOR}: anchoring on the last band placement
 * would run off the end of the band as soon as the harness adds one more
 * `TOOL_*` name, while the ceiling keeps the policy strictly inside the band.
 * Kept beside the floor (not inlined at the call) so the pin in
 * tests/host/lifecycle.spec.ts guards it.
 */
export declare const ZOTERO_PROMPT_ORDER_OFFSET = 50;
/**
 * The connectivity sentence: what the plugin does on a connectivity failure.
 * The failure surfaces as the tool call's own typed error result (no human
 * prompt is raised and nothing is retried), so the model reports it rather
 * than waiting on a question. Its own export because the lifecycle spec pins
 * this sentence to the policy text.
 */
export declare const CONNECTIVITY_POLICY_SENTENCE = "On connectivity failures (Zotero not running, local API disabled, unsupported API version, timeout), the tool call fails with that typed error and nothing is retried; tell the user what failed and point them at the fix, then wait for them to say it is resolved.";
/**
 * The write policy sentence: the conversion contract, the approval gate, and
 * the write failures the model routes on. Its own export for the same
 * reason: the lifecycle spec pins it. The trailing clauses are the ones that
 * keep the model on the sanctioned path and out of the raw local API, and that
 * tell it a successful result needs no verification read: the plugin holds the
 * in-process gate, so anything else is out of bounds, and the result already
 * carries the created ref, key, and versions. Deletion arms state their own
 * irreversibility, and the no-overclaim clause forbids reporting beyond the
 * result.
 */
export declare const WRITE_POLICY_SENTENCE: string;
/**
 * What the model is told while the write capability is off. Silence here was
 * the defect behind an improvised write: with no mention of writes at all, a
 * model that is asked to change the library reaches for the local API through
 * the shell. The sentence names the off state, the way to turn it on, and the
 * routes that are out of bounds even when the user asks for the change
 * directly. Its own export so the lifecycle spec pins it.
 */
export declare const WRITE_DISABLED_SENTENCE: string;
/**
 * Register the policy section; the registration unwinds with the plugin
 * fiber. The text provider re-reads the live config at each assembly, so
 * settings edits are reflected without re-registration.
 * @param ctx - the plugin context.
 * @param config - the live resolved config getter.
 */
export declare function registerPromptSection(ctx: Context, config: () => ResolvedConfig): void;
//# sourceMappingURL=prompt.d.ts.map