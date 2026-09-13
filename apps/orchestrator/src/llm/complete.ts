/**
 * Multi-provider LLM completion engine.
 * Supports Google Gemini (Gemini 3.6/3.7 Flash), Anthropic Claude, OpenAI (GPT-4o/mini),
 * Groq, DeepSeek, and Sarvam.
 */

import { config } from '../config.js';
import { isReasoningModel, reasoningHeadroom } from './reasoning.js';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface CompleteOptions {
  temperature?: number;
  maxTokens?: number;
  /**
   * Model to use instead of the primary provider's configured default.
   *
   * Applied to the FIRST provider only, never to the fallbacks. A model name
   * belongs to the vendor that serves it — "qwen/qwen3.8-27b" means nothing to
   * Anthropic — so pushing an override down the whole chain would turn one
   * misconfigured value into a total outage instead of a single failed call.
   * Scoped this way, a name the primary rejects simply falls through to the
   * next provider on its own default, which is exactly today's behaviour.
   */
  model?: string;
}

interface OpenAiCompatibleProvider {
  type: 'openai-compatible';
  url: string;
  model: string;
  headers: Record<string, string>;
}

interface AnthropicProvider {
  type: 'anthropic';
  url: string;
  model: string;
  headers: Record<string, string>;
}

interface GeminiProvider {
  type: 'gemini';
  key: string;
  model: string;
}

type Provider = OpenAiCompatibleProvider | AnthropicProvider | GeminiProvider;

/** Returns all configured providers in priority order. */
function resolveProviders(): Provider[] {
  const providers: Provider[] = [];

  // 1. Google Gemini (Native API)
  const geminiKey = config.geminiApiKey || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (geminiKey && geminiKey.trim().length > 0) {
    providers.push({
      type: 'gemini',
      key: geminiKey.trim(),
      model: config.geminiModel || process.env.GEMINI_MODEL || 'gemini-3.6-flash',
    });
  }

  // 2. OpenAI
  const openaiKey = config.openaiApiKey || process.env.OPENAI_API_KEY;
  if (openaiKey && openaiKey.trim().length > 0) {
    const baseUrl = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '');
    providers.push({
      type: 'openai-compatible',
      url: `${baseUrl}/chat/completions`,
      model: process.env.OPENAI_MODEL || config.llmModel || 'gpt-4o-mini',
      headers: { Authorization: `Bearer ${openaiKey.trim()}` },
    });
  }

  // 3. Groq
  const groqKey = process.env.GROQ_API_KEY;
  if (groqKey && groqKey.trim().length > 0) {
    providers.push({
      type: 'openai-compatible',
      url: 'https://api.groq.com/openai/v1/chat/completions',
      model: process.env.GROQ_MODEL || 'openai/gpt-oss-120b',
      headers: { Authorization: `Bearer ${groqKey.trim()}` },
    });
  }

  // 4. Anthropic Claude
  const anthropicKey = config.anthropicApiKey || process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY;
  if (anthropicKey && anthropicKey.trim().length > 0) {
    providers.push({
      type: 'anthropic',
      url: 'https://api.anthropic.com/v1/messages',
      model: process.env.ANTHROPIC_MODEL || process.env.CLAUDE_MODEL || 'claude-3-5-sonnet-20241022',
      headers: {
        'x-api-key': anthropicKey.trim(),
        'anthropic-version': '2023-06-01',
      },
    });
  }

  // 5. DeepSeek
  const deepseekKey = process.env.DEEPSEEK_API_KEY;
  if (deepseekKey && deepseekKey.trim().length > 0) {
    providers.push({
      type: 'openai-compatible',
      url: 'https://api.deepseek.com/chat/completions',
      model: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
      headers: { Authorization: `Bearer ${deepseekKey.trim()}` },
    });
  }

  // 6. Sarvam
  const sarvamKey = config.sarvamApiKey;
  if (sarvamKey && sarvamKey !== 'mock_sarvam_api_key' && sarvamKey !== 'mock_key') {
    providers.push({
      type: 'openai-compatible',
      url: 'https://api.sarvam.ai/v1/chat/completions',
      model: 'sarvam-105b',
      headers: { Authorization: `Bearer ${sarvamKey}`, 'api-subscription-key': sarvamKey },
    });
  }

  return providers;
}

/**
 * How many times one rate-limited request is retried before giving up.
 *
 * Two, because the limit being worked around is a per-minute token budget that
 * other calls in the same lesson are also drawing on: the first retry can lose
 * a race with them, and a second is usually enough. More than that and the room
 * is waiting on a picture for longer than the picture is worth.
 */
const RATE_LIMIT_RETRIES = 2;

/**
 * The longest a rate-limited request will wait before giving up on the answer.
 *
 * A classroom is the constraint, not the quota: a diagram that lands after the
 * teacher has moved on is worse than no diagram, and this whole path is meant
 * to fail soft. Eight seconds is what a per-minute token limit actually asks
 * for at the top of its range — measured against the live key, requests were
 * refused with waits from 75ms up to 5.79s — while still refusing outright the
 * multi-minute waits a daily quota asks for.
 *
 * Safe to wait this long because every caller of `tryComplete` is a background
 * task: a reading suggestion, a report, a diagram that is explicitly not
 * awaited by the turn that asked for it. The live spoken conversation does not
 * come through here at all — it runs on the model Agora resells.
 */
const RATE_LIMIT_MAX_WAIT_MS = 8_000;

/**
 * How long to wait before retrying a 429, or `null` if it should not be
 * retried at all.
 *
 * Providers say how long to wait in two different places and neither is
 * guaranteed: the standard `retry-after` header (in seconds), and — for Groq,
 * which is what this deployment runs — only inside the error message, as
 * "Please try again in 4.4925s" or "in 75ms". Both are read, the header first,
 * and anything unparseable falls back to a short fixed pause rather than
 * abandoning an answer over a missing header.
 *
 * Exported for the unit suite: every branch here is reachable only from a live
 * 429, which is not something a test can conjure on demand.
 */
export function retryDelayMs(response: Response, body: string): number | null {
  const header = response.headers.get('retry-after');
  const fromHeader = header ? Number(header) * 1000 : Number.NaN;
  if (Number.isFinite(fromHeader) && fromHeader >= 0) {
    return fromHeader <= RATE_LIMIT_MAX_WAIT_MS ? Math.max(fromHeader, 50) : null;
  }

  // The duration is captured as a whole before its parts are read, so that the
  // numbers further along the message — "Limit 8000, Used 7197" — cannot be
  // mistaken for one. Groq writes short waits as "4.4925s" or "75ms" and long
  // ones in compound form as "3m30s", and reading only the first component of
  // that would turn a three-minute wait into a three-millisecond one.
  const span = /try again in\s+((?:[\d.]+\s*(?:ms|h|m|s)\s*)+)/i.exec(body);
  if (span?.[1]) {
    const unitMs: Record<string, number> = { ms: 1, s: 1000, m: 60_000, h: 3_600_000 };
    let total = 0;
    let matched = false;
    for (const part of span[1].matchAll(/([\d.]+)\s*(ms|h|m|s)/gi)) {
      const value = Number(part[1]);
      const unit = unitMs[part[2]?.toLowerCase() ?? ''];
      if (!Number.isFinite(value) || unit === undefined) continue;
      total += value * unit;
      matched = true;
    }
    if (matched) {
      return total <= RATE_LIMIT_MAX_WAIT_MS ? Math.max(total, 50) : null;
    }
  }

  // A 429 with no usable hint. One short pause is worth trying; the retry
  // ceiling stops this becoming an unbounded loop.
  return 500;
}

/** Determines primary provider. */
function resolveProvider(): Provider | null {
  const list = resolveProviders();
  return list.length > 0 ? (list[0] ?? null) : null;
}

async function executeProvider(
  provider: Provider,
  messages: ChatMessage[],
  options: CompleteOptions,
): Promise<string | null> {

  try {
    // 1. Google Gemini Native Handler
    if (provider.type === 'gemini') {
      const systemMsg = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
      const chatContents = messages
        .filter((m) => m.role !== 'system')
        .map((m) => ({
          role: m.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: m.content }],
        }));
      const contents = chatContents.length > 0 ? chatContents : [{ role: 'user', parts: [{ text: 'Hello' }] }];

      // Gemini 3.x models use internal reasoning/thought tokens that count against maxOutputTokens.
      // We set maxOutputTokens comfortably (2500+) so thoughts do not starve the visible response.
      const requested = options.maxTokens ?? 1000;
      const maxOutputTokens = Math.max(requested + 1500, 2500);

      const bodyPayload: Record<string, unknown> = {
        contents,
        generationConfig: {
          temperature: options.temperature ?? 0.4,
          maxOutputTokens,
        },
      };

      if (systemMsg && systemMsg.trim().length > 0) {
        bodyPayload.system_instruction = {
          parts: [{ text: systemMsg.trim() }],
        };
      }

      const url = `https://generativelanguage.googleapis.com/v1beta/models/${provider.model}:generateContent?key=${provider.key}`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bodyPayload),
      });

      if (!response.ok) {
        const errText = await response.text().catch(() => '');
        console.error(`[llm:gemini] request failed: ${response.status} ${errText.slice(0, 500)}`);
        return null;
      }

      const data = (await response.json()) as {
        candidates?: Array<{
          content?: {
            parts?: Array<{ text?: string }>;
          };
        }>;
      };

      const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('').trim();
      return text && text.length > 0 ? text : null;
    }

    // 2. Anthropic Claude Handler
    if (provider.type === 'anthropic') {
      const systemMsg = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
      const nonSystemMsgs = messages
        .filter((m) => m.role !== 'system')
        .map((m) => ({
          role: m.role === 'assistant' ? ('assistant' as const) : ('user' as const),
          content: m.content,
        }));

      const formattedMsgs = nonSystemMsgs.length > 0 ? nonSystemMsgs : [{ role: 'user' as const, content: 'Hello' }];

      const response = await fetch(provider.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...provider.headers,
        },
        body: JSON.stringify({
          model: provider.model,
          system: systemMsg || undefined,
          messages: formattedMsgs,
          temperature: options.temperature ?? 0.4,
          max_tokens: options.maxTokens ?? 700,
        }),
      });

      if (!response.ok) {
        const body = await response.text().catch(() => '');
        console.error(`[llm:claude] completion request failed: ${response.status} ${body.slice(0, 500)}`);
        return null;
      }

      const data = (await response.json()) as {
        content?: Array<{ type: string; text: string }>;
      };
      const text = data.content?.find((c) => c.type === 'text')?.text?.trim();
      return text && text.length > 0 ? text : null;
    }

    // 3. OpenAI & OpenAI-compatible providers
    //
    // Reasoning models (gpt-oss, qwen3, deepseek-reasoner) spend part of the
    // completion budget on hidden reasoning tokens that never reach `content`.
    // At a tight budget they burn all of it thinking and return an empty
    // string, which reads as "the provider is broken" rather than "the cap was
    // too low". Gemini already gets this headroom above; mirror it here so a
    // reasoning model cannot answer blank.
    const requestedMax = options.maxTokens ?? 700;
    const maxTokens = isReasoningModel(provider.model)
      ? reasoningHeadroom(requestedMax)
      : requestedMax;

    const send = (): Promise<Response> =>
      fetch(provider.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...provider.headers,
        },
        body: JSON.stringify({
          model: provider.model,
          messages,
          temperature: options.temperature ?? 0.4,
          max_tokens: maxTokens,
        }),
      });

    let response = await send();

    // A 429 here is very often a per-minute quota that has already almost
    // cleared. Groq's free tier allows 8000 tokens a minute and a reasoning
    // model reserves `reasoningHeadroom` of them per call, so a lesson that
    // runs gap detection, a reading suggestion and a diagram close together
    // trips the limit routinely — and measured against the real key, the wait
    // it asks for is usually under a second. Without this, that answer is
    // simply lost: the provider chain falls through, `tryComplete` returns
    // null, and the caller degrades silently.
    //
    // Deliberately bounded. Waiting is only ever right for a limit that clears
    // on its own, so a request for longer than `RATE_LIMIT_MAX_WAIT_MS` is
    // treated as "not worth a lesson's time" and given up on immediately.
    for (let attempt = 0; response.status === 429 && attempt < RATE_LIMIT_RETRIES; attempt += 1) {
      const body = await response.text().catch(() => '');
      const wait = retryDelayMs(response, body);
      if (wait === null) {
        console.error(`[llm] rate limited, not retryable: ${body.slice(0, 300)}`);
        return null;
      }
      console.warn(`[llm] rate limited, retrying in ${wait}ms (attempt ${attempt + 1})`);
      await new Promise((resolve) => setTimeout(resolve, wait));
      response = await send();
    }

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      console.error(`[llm] completion request failed: ${response.status} ${body.slice(0, 500)}`);
      return null;
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const text = data.choices?.[0]?.message?.content?.trim();
    return text && text.length > 0 ? text : null;
  } catch (err) {
    console.error('[llm] completion request errored:', err);
    return null;
  }
}

/**
 * Executes chat completion with the active LLM provider.
 * Automatically falls back to secondary configured providers if primary fails.
 */
export async function tryComplete(
  messages: ChatMessage[],
  options: CompleteOptions = {},
): Promise<string | null> {
  const providers = resolveProviders();
  if (providers.length === 0) return null;

  for (const [index, provider] of providers.entries()) {
    // See `CompleteOptions.model`: the override belongs to the primary vendor
    // and is not carried down the fallback chain.
    const target =
      index === 0 && options.model?.trim()
        ? { ...provider, model: options.model.trim() }
        : provider;
    try {
      const result = await executeProvider(target, messages, options);
      if (result && result.trim().length > 0) {
        return result;
      }
    } catch {
      // Try next provider
    }
  }

  return null;
}

