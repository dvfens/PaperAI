import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { z } from "zod";
import { env, features } from "@/server/env";
import { HttpError } from "@/server/http";
import { errorCode, log } from "@/server/log";

let client: Anthropic | null = null;
function anthropic(): Anthropic {
  if (!features.claude()) throw new HttpError(503, "claude_not_configured", "Claude is not configured.");
  client ??= new Anthropic({ apiKey: env.anthropicApiKey, maxRetries: env.claudeMaxRetries, timeout: env.claudeTimeoutMs });
  return client;
}

export class ClaudeUnavailableError extends Error {
  constructor(readonly reason: string) {
    super(reason);
  }
}

type Effort = "low" | "medium" | "high";
type UserContent = Anthropic.Beta.Messages.BetaContentBlockParam[];

/** Server-side refusal fallback is available on the Opus / Sonnet / Fable tiers (not Haiku). */
function fallbackParams(): { betas: string[]; fallbacks?: "default" } {
  return /^claude-(opus|sonnet|fable)/.test(env.claudeModel)
    ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" }
    : { betas: [] };
}

/**
 * One structured call to Claude. The response is constrained to the Zod schema via structured
 * outputs and parsed by the SDK. Refusals and truncations raise ClaudeUnavailableError so callers can
 * degrade to the rule-based path instead of showing a half-understood result.
 */
/** Fast mode exists on these models only (Claude API). */
const FAST_MODELS = /^claude-(opus-5-5|opus-5|opus-4-8)$/;

export async function structuredCall<S extends z.ZodType>(opts: {
  task: string;
  schema: S;
  system: string;
  /**
   * Context that stays the same across many calls (e.g. the form's field list). It is sent as a
   * second cached system block, so repeated calls only process the short part that changes.
   */
  cachedContext?: string;
  content: UserContent;
  effort: Effort;
  maxTokens: number;
  /** Ask for fast mode (falls back to standard speed if it is unavailable or rate-limited). */
  fast?: boolean;
}): Promise<z.infer<S>> {
  const started = Date.now();
  const fast = Boolean(opts.fast && env.claudeFastMode && FAST_MODELS.test(env.claudeModel));
  const request = (withFast: boolean) => {
    const fb = fallbackParams();
    return anthropic().beta.messages.parse({
      model: env.claudeModel,
      max_tokens: opts.maxTokens,
      ...fb,
      betas: [...fb.betas, ...(withFast ? ["fast-mode-2026-02-01"] : [])],
      ...(withFast ? { speed: "fast" as const } : {}),
      system: [
        { type: "text", text: opts.system, cache_control: { type: "ephemeral" } },
        ...(opts.cachedContext ? [{ type: "text" as const, text: opts.cachedContext, cache_control: { type: "ephemeral" as const } }] : []),
      ],
      output_config: { effort: opts.effort, format: betaZodOutputFormat(opts.schema) },
      messages: [{ role: "user", content: opts.content }],
    });
  };
  try {
    let res;
    try {
      res = await request(fast);
    } catch (err) {
      // Fast mode has its own rate limits and is a preview: never let it cost the answer.
      if (!fast || !(err instanceof Anthropic.RateLimitError || err instanceof Anthropic.BadRequestError || err instanceof Anthropic.PermissionDeniedError)) throw err;
      log.warn("claude.fast_unavailable", { reason: opts.task, status: err.status ?? 0 });
      res = await request(false);
    }
    if (res.stop_reason === "refusal") {
      log.warn("claude.refusal", { reason: opts.task });
      throw new ClaudeUnavailableError("refusal");
    }
    if (res.stop_reason === "max_tokens") {
      log.warn("claude.truncated", { reason: opts.task });
      throw new ClaudeUnavailableError("truncated");
    }
    if (!res.parsed_output) throw new ClaudeUnavailableError("unparsed");
    log.info("claude.ok", {
      reason: opts.task,
      durationMs: Date.now() - started,
      inputTokens: res.usage.input_tokens,
      cacheReadTokens: res.usage.cache_read_input_tokens ?? 0,
      outputTokens: res.usage.output_tokens,
      speed: (res.usage as { speed?: string | null }).speed ?? null,
    });
    return res.parsed_output as z.infer<S>;
  } catch (err) {
    if (err instanceof ClaudeUnavailableError || err instanceof HttpError) throw err;
    if (err instanceof Anthropic.RateLimitError) {
      log.warn("claude.rate_limited", { reason: opts.task });
      throw new ClaudeUnavailableError("rate_limited");
    }
    if (err instanceof Anthropic.AuthenticationError) {
      log.error("claude.auth", { reason: opts.task });
      throw new ClaudeUnavailableError("auth");
    }
    if (err instanceof Anthropic.APIError) {
      log.error("claude.api_error", { reason: opts.task, status: err.status ?? 0 });
      throw new ClaudeUnavailableError("api_error");
    }
    log.error("claude.error", { reason: opts.task, code: errorCode(err) });
    throw new ClaudeUnavailableError("network");
  }
}

export function imageBlock(mediaType: "image/jpeg" | "image/png", bytes: Buffer): Anthropic.Beta.Messages.BetaImageBlockParam {
  return { type: "image", source: { type: "base64", media_type: mediaType, data: bytes.toString("base64") } };
}

export function pdfBlock(bytes: Buffer): Anthropic.Beta.Messages.BetaRequestDocumentBlock {
  return { type: "document", source: { type: "base64", media_type: "application/pdf", data: bytes.toString("base64") } };
}

export function textBlock(text: string): Anthropic.Beta.Messages.BetaTextBlockParam {
  return { type: "text", text };
}
