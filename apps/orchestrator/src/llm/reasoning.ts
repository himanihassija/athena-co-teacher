/**
 * Reasoning-model detection and completion budgeting, shared by every caller.
 *
 * This lives on its own because it previously did not, and the two copies drifted
 * into contradicting each other:
 *
 *   - `llm/complete.ts` had the right remedy (extra headroom) behind a pattern —
 *     `/gpt-oss|qwen3|reasoner|thinking/i` — that does not match "gpt-5", so the
 *     guard never fired for the model the classroom agent was actually running.
 *   - `agent/agentLifecycle.ts` had the right predicate (`startsWith('gpt-5')`)
 *     but no remedy: a flat 700-token cap with no headroom at all.
 *
 * The failure mode this exists to prevent is silent. A reasoning model spends
 * completion budget on hidden reasoning tokens that never appear in the returned
 * content, so a cap that is too low comes back as an empty string rather than an
 * error — which presents as "the UI says she is speaking but there is no sound",
 * with nothing logged anywhere.
 */

/**
 * Whether a model spends completion budget on hidden reasoning tokens, so its
 * visible reply needs extra headroom to avoid coming back empty.
 *
 * `gpt-5` covers the whole family — `gpt-5`, `gpt-5-mini`, `gpt-5-nano` — which
 * is three of the four models Agora resells to this project.
 */
export function isReasoningModel(model: string): boolean {
  return /gpt-5|gpt-oss|qwen3|reasoner|thinking/i.test(model);
}

/**
 * The completion cap to send for a reasoning model, given the visible reply
 * length actually wanted.
 *
 * The floor of 2500 matters as much as the margin: a short requested length —
 * a two-sentence classroom answer — still needs room for the reasoning pass
 * that precedes it, and `requested + 1500` alone would not give it one.
 */
export function reasoningHeadroom(requestedMax: number): number {
  return Math.max(requestedMax + 1500, 2500);
}
