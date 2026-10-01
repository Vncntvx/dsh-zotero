/**
 * The model-facing Zotero policy section: when the tools may run, how the
 * tools compose into a retrieval workflow, the honesty rules (provenance
 * fails closed, no invented page locators, absence is not evidence), and the
 * untrusted-data rule that keeps library content from acting as instructions.
 * Parameter-level detail lives in each tool's own description; this section
 * keeps only the cross-tool decisions, so the fixed per-turn cost stays small
 * and the two surfaces cannot drift.
 * The section text is a provider evaluated at every assembly, so the tool
 * cap values it states always track the live config — the model never has
 * to guess a limit the plugin will reject.
 * Registered once, after the first-party per-tool sections.
 * @module dsh-zotero/prompt
 */
import type { Context } from '@deepseek-ai/cordis';
import type { ResolvedConfig } from './config.js';
/**
 * Central placement anchor the policy trails: the tail of the first-party
 * tool-guidance band (`TOOL_*` placements end here, the SDK section follows
 * far later), so the policy reads after every per-tool section it
 * complements.
 */
export declare const ZOTERO_PROMPT_ANCHOR: "TOOL_REPORT";
/**
 * Headroom over the anchor: half the gap to the next first-party placement
 * (`TOOL_REPORT` 2900 → `TOOL_COMPUTER_USE` 3000), so a first-party insertion
 * between them cannot collide with this section. Kept beside the anchor (not
 * inlined at the call) so the pin in tests/lifecycle.spec.ts guards it.
 */
export declare const ZOTERO_PROMPT_ORDER_OFFSET = 50;
/**
 * The connectivity sentence: what the plugin does on a connectivity failure
 * and how the model should read the question it asks. Its own export because
 * the lifecycle spec pins this sentence to the policy text.
 */
export declare const CONNECTIVITY_POLICY_SENTENCE = "On connectivity failures (Zotero not running, local API disabled, unsupported API version, timeout), the plugin asks the user how to proceed with a recommended action; follow the user's choice and do not retry repeatedly.";
/**
 * The write policy sentence: the conversion contract, the approval gate, and
 * the write failures the model routes on. Its own export for the same
 * reason — the lifecycle spec pins it. The trailing clauses are the ones that
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