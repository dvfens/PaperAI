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
export async function structuredCall<S extends z.ZodType>(opts: {
  task: string;
  schema: S;
  system: string;
  content: UserContent;
  effort: Effort;
  maxTokens: number;
}): Promise<z.infer<S>> {
  const started = Date.now();
  try {
    const res = await anthropic().beta.messages.parse({
      model: env.claudeModel,
      max_tokens: opts.maxTokens,
      ...fallbackParams(),
      system: [{ type: "text", text: opts.system, cache_control: { type: "ephemeral" } }],
      output_config: { effort: opts.effort, format: betaZodOutputFormat(opts.schema) },
      messages: [{ role: "user", content: opts.content }],
    });
    if (res.stop_reason === "refusal") {
      log.warn("claude.refusal", { reason: opts.task });
      throw new ClaudeUnavailableError("refusal");
    }
    if (res.stop_reason === "max_tokens") {
      log.warn("claude.truncated", { reason: opts.task });
      throw new ClaudeUnavailableError("truncated");
    }
    if (!res.parsed_output) throw new ClaudeUnavailableError("unparsed");
    log.info("claude.ok", { reason: opts.task, durationMs: Date.now() - started });
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
