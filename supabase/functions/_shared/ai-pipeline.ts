import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

export interface ProviderConfig {
  name: string;
  provider: string;
  apiKey: string;
  url: string;
  model: string;
}

export interface PipelineConfig {
  enabled: boolean;
  providers: ProviderConfig[];
  primary: ProviderConfig;
}

const DEFAULT_MODELS: Record<string, string> = {
  openai: "gpt-4o",
  gemini: "gemini-2.5-flash",
  anthropic: "claude-sonnet-4-20250514",
};

const PROVIDER_URLS: Record<string, string> = {
  openai: "https://api.openai.com/v1/chat/completions",
  gemini: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
  anthropic: "https://api.anthropic.com/v1/messages",
};

const PROVIDER_NAMES: Record<string, string> = {
  openai: "OpenAI",
  gemini: "Gemini",
  anthropic: "Claude",
};

const SUPPORTED_PROVIDERS = new Set(Object.keys(DEFAULT_MODELS));

/** Fetch pipeline config for a user — main + optional fallback */
export async function getPipelineConfig(userId: string): Promise<PipelineConfig> {
  const supabaseAdmin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const { data: prefs } = await supabaseAdmin
    .from("user_preferences")
    .select("key, value")
    .eq("user_id", userId)
    .in("key", [
      "ai_provider", "ai_api_key",
      "ai_fallback_provider",
      "ai_pipeline_enabled",
      "ai_key_openai", "ai_key_gemini", "ai_key_anthropic",
      "ai_model_primary", "ai_model_openai", "ai_model_gemini", "ai_model_anthropic",
    ]);

  const pm: Record<string, string> = {};
  (prefs || []).forEach((p: any) => { pm[p.key] = p.value; });

  // Build primary provider — default OpenAI
  const rawPrimary = (pm["ai_provider"] || "openai").toLowerCase();
  const primaryName = SUPPORTED_PROVIDERS.has(rawPrimary) ? rawPrimary : "openai";
  const primaryKey = pm["ai_api_key"] || pm[`ai_key_${primaryName}`] || "";
  const primaryModel = pm["ai_model_primary"] || pm[`ai_model_${primaryName}`] || DEFAULT_MODELS[primaryName];
  const primary = buildProvider(primaryName, primaryKey, primaryModel);

  // Build fallback provider — must differ from primary and have a key
  const rawFallback = (pm["ai_fallback_provider"] || "").toLowerCase();
  const fallbackName = SUPPORTED_PROVIDERS.has(rawFallback) && rawFallback !== primaryName
    ? rawFallback
    : (primaryName === "openai" ? "gemini" : "openai");

  const fallbackKey = pm[`ai_key_${fallbackName}`]
    || (fallbackName === primaryName ? "" : "") // never reuse primary key
    || "";
  const fallbackModel = pm[`ai_model_${fallbackName}`] || DEFAULT_MODELS[fallbackName];
  const fallback = fallbackKey
    ? buildProvider(fallbackName, fallbackKey, fallbackModel)
    : null;

  const pipelineEnabled = pm["ai_pipeline_enabled"] === "true";
  const providers = fallback ? [primary, fallback] : [primary];

  return {
    enabled: pipelineEnabled && providers.length >= 2,
    providers,
    primary,
  };
}

function buildProvider(name: string, key: string, model?: string): ProviderConfig {
  return {
    name: PROVIDER_NAMES[name] || name,
    provider: name,
    apiKey: key,
    url: PROVIDER_URLS[name] || PROVIDER_URLS.openai,
    model: model || DEFAULT_MODELS[name] || DEFAULT_MODELS.openai,
  };
}

/** Retry a function with exponential backoff on 429 */
async function withRetry<T>(fn: () => Promise<T>, retries = 3, baseDelay = 3000): Promise<T> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      const is429 = err?.status === 429 || err?.message?.includes("Rate limited") || err?.message?.includes("429");
      if (is429 && attempt < retries) {
        const delay = baseDelay * Math.pow(2, attempt) + Math.random() * 1000;
        console.log(`[Retry] Rate limited, waiting ${Math.round(delay)}ms (attempt ${attempt + 1}/${retries})`);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      throw err;
    }
  }
  throw new Error("Max retries exceeded");
}

/** Call a single AI provider with messages + optional tool calling */
export async function callProvider(
  config: ProviderConfig,
  messages: any[],
  tools?: any[],
  toolChoice?: any,
  maxTokens = 8192
): Promise<{ tool_arguments: string; raw?: any }> {
  return withRetry(async () => {
    if (config.provider === "anthropic") {
      return callAnthropic(config, messages, tools, toolChoice, maxTokens);
    }
    return callOpenAICompat(config, messages, tools, toolChoice);
  });
}

async function callAnthropic(
  config: ProviderConfig,
  messages: any[],
  tools?: any[],
  toolChoice?: any,
  maxTokens = 8192
): Promise<{ tool_arguments: string }> {
  if (!config.apiKey) throw Object.assign(new Error(`${config.name} API key is not configured`), { status: 400 });

  const systemMsg = messages.find((m: any) => m.role === "system")?.content || "";
  const userMsgs = messages.filter((m: any) => m.role !== "system");

  const body: any = { model: config.model, max_tokens: maxTokens, system: systemMsg, messages: userMsgs };
  if (tools) {
    body.tools = tools.map((t: any) => ({
      name: t.function.name,
      description: t.function.description,
      input_schema: t.function.parameters,
    }));
    if (toolChoice) body.tool_choice = { type: "tool", name: toolChoice.function.name };
  }

  const response = await fetch(config.url, {
    method: "POST",
    headers: { "x-api-key": config.apiKey, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const err = await response.text();
    console.error(`${config.name} (${config.model}) error:`, response.status, err);
    if (response.status === 429) throw Object.assign(new Error("Rate limited"), { status: 429 });
    if (response.status === 402) throw Object.assign(new Error("Credits exhausted"), { status: 402 });
    throw new Error(`${config.name} error: ${response.status}`);
  }

  const data = await response.json();
  const toolUse = data.content?.find((c: any) => c.type === "tool_use");
  if (toolUse) return { tool_arguments: JSON.stringify(toolUse.input) };
  return { tool_arguments: data.content?.find((c: any) => c.type === "text")?.text || "{}" };
}

async function callOpenAICompat(
  config: ProviderConfig,
  messages: any[],
  tools?: any[],
  toolChoice?: any
): Promise<{ tool_arguments: string }> {
  if (!config.apiKey) throw Object.assign(new Error(`${config.name} API key is not configured`), { status: 400 });

  const body: any = { model: config.model, messages };
  if (tools) body.tools = tools;
  if (toolChoice) body.tool_choice = toolChoice;

  const response = await fetch(config.url, {
    method: "POST",
    headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errText = await response.text();
    console.error(`${config.name} (${config.model}) error:`, response.status, errText);
    if (response.status === 429) throw Object.assign(new Error("Rate limited"), { status: 429 });
    if (response.status === 402) throw Object.assign(new Error("Credits exhausted"), { status: 402 });
    throw new Error(`${config.name} error: ${response.status}`);
  }

  const aiResult = await response.json();
  const toolCall = aiResult.choices?.[0]?.message?.tool_calls?.[0];
  if (toolCall) return { tool_arguments: toolCall.function.arguments };
  return { tool_arguments: aiResult.choices?.[0]?.message?.content || "{}" };
}

/** Call AI with text-only response (no tool calling) */
export async function callProviderText(config: ProviderConfig, messages: any[]): Promise<string> {
  if (!config.apiKey) throw Object.assign(new Error(`${config.name} API key is not configured`), { status: 400 });

  if (config.provider === "anthropic") {
    const systemMsg = messages.find((m: any) => m.role === "system")?.content || "";
    const userMsgs = messages.filter((m: any) => m.role !== "system");
    const response = await fetch(config.url, {
      method: "POST",
      headers: { "x-api-key": config.apiKey, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
      body: JSON.stringify({ model: config.model, max_tokens: 4096, system: systemMsg, messages: userMsgs, temperature: 0.1 }),
    });
    if (!response.ok) throw new Error(`${config.name} error: ${response.status}`);
    const data = await response.json();
    return data.content?.find((c: any) => c.type === "text")?.text || "[]";
  }

  const response = await fetch(config.url, {
    method: "POST",
    headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: config.model, messages, temperature: 0.1 }),
  });
  if (!response.ok) throw new Error(`${config.name} error: ${response.status}`);
  const data = await response.json();
  return data.choices?.[0]?.message?.content || "[]";
}

/**
 * Run the AI pipeline.
 * Single mode: primary only, with automatic fallback to the configured fallback provider.
 * Pipeline mode: main drafts → fallback reviews/finalizes.
 */
export async function runPipeline(opts: {
  config: PipelineConfig;
  systemPrompt: string;
  userPrompt: string;
  tools?: any[];
  toolChoice?: any;
  reviewInstruction: string;
  maxTokens?: number;
}): Promise<{ result: { tool_arguments: string }; providerChain: string[] }> {
  const { config, systemPrompt, userPrompt, tools, toolChoice, reviewInstruction, maxTokens = 8192 } = opts;

  const fallback = config.providers.find((p) => p.provider !== config.primary.provider) || null;

  if (!config.enabled || config.providers.length <= 1) {
    const provider = config.primary;
    console.log(`[Pipeline] Single mode: ${provider.name} (${provider.model})`);
    try {
      const result = await callProvider(provider, [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ], tools, toolChoice, maxTokens);
      return { result, providerChain: [`${provider.name} (${provider.model})`] };
    } catch (err: any) {
      if (fallback && fallback.apiKey) {
        console.warn(`[Pipeline] ${provider.name} failed (${err.message}), falling back to ${fallback.name}`);
        const result = await callProvider(fallback, [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ], tools, toolChoice, maxTokens);
        return { result, providerChain: [`${provider.name} (failed)`, `${fallback.name} (${fallback.model})`] };
      }
      throw err;
    }
  }

  const chain: string[] = [];
  let currentOutput: any = null;

  for (let i = 0; i < config.providers.length; i++) {
    const provider = config.providers[i];
    const isFirst = i === 0;
    const isLast = i === config.providers.length - 1;

    let messages: any[];

    if (isFirst) {
      console.log(`[Pipeline] Step ${i + 1}/${config.providers.length}: ${provider.name} (${provider.model}) — DRAFT`);
      messages = [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ];
    } else {
      const role = isLast ? "FINAL REVIEWER & EXECUTOR" : "REVIEWER";
      console.log(`[Pipeline] Step ${i + 1}/${config.providers.length}: ${provider.name} (${provider.model}) — ${role}`);

      const reviewPrompt = `You are the ${role} in a multi-AI quality pipeline.

${isLast ? "You have the FINAL say. Your output is what gets delivered to the user." : "Review and improve the draft below. Fix errors, improve quality, ensure accuracy."}

${reviewInstruction}

PREVIOUS AI OUTPUT TO REVIEW:
${JSON.stringify(currentOutput, null, 2)}

ORIGINAL REQUEST:
${userPrompt}

Review the output carefully:
1. Check for factual accuracy — does it match the source data?
2. Check for fabricated/hallucinated content — flag and remove anything not in the source
3. Improve clarity, relevance, and professional quality
4. Ensure all required fields are populated
5. Return the corrected and improved version using the same tool/format`;

      messages = [
        { role: "system", content: systemPrompt },
        { role: "user", content: reviewPrompt },
      ];
    }

    try {
      const result = await callProvider(provider, messages, tools, toolChoice, maxTokens);
      currentOutput = JSON.parse(result.tool_arguments);
      chain.push(`${provider.name} (${provider.model})`);
    } catch (err: any) {
      console.warn(`[Pipeline] ${provider.name} (${provider.model}) failed: ${err.message}. Skipping.`);
      if (isFirst && !currentOutput) throw err;
      chain.push(`${provider.name} (skipped)`);
    }
  }

  return {
    result: { tool_arguments: JSON.stringify(currentOutput) },
    providerChain: chain,
  };
}

/**
 * Run pipeline for text-only responses (no tool calling).
 */
export async function runPipelineText(opts: {
  config: PipelineConfig;
  systemPrompt: string;
  userPrompt: string;
  reviewInstruction: string;
}): Promise<{ result: string; providerChain: string[] }> {
  const { config, systemPrompt, userPrompt, reviewInstruction } = opts;

  const fallback = config.providers.find((p) => p.provider !== config.primary.provider) || null;

  if (!config.enabled || config.providers.length <= 1) {
    const provider = config.primary;
    try {
      const result = await callProviderText(provider, [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ]);
      return { result, providerChain: [`${provider.name} (${provider.model})`] };
    } catch (err: any) {
      if (fallback && fallback.apiKey) {
        console.warn(`[Pipeline-text] ${provider.name} failed (${err.message}), falling back to ${fallback.name}`);
        const result = await callProviderText(fallback, [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ]);
        return { result, providerChain: [`${provider.name} (failed)`, `${fallback.name} (${fallback.model})`] };
      }
      throw err;
    }
  }

  const chain: string[] = [];
  let current = "";

  for (let i = 0; i < config.providers.length; i++) {
    const provider = config.providers[i];
    const isFirst = i === 0;
    const isLast = i === config.providers.length - 1;

    const messages = isFirst
      ? [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }]
      : [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: `You are the ${isLast ? "FINAL REVIEWER" : "REVIEWER"}. ${reviewInstruction}\n\nPREVIOUS:\n${current}\n\nORIGINAL REQUEST:\n${userPrompt}`,
          },
        ];

    try {
      current = await callProviderText(provider, messages);
      chain.push(`${provider.name} (${provider.model})`);
    } catch (err: any) {
      console.warn(`[Pipeline-text] ${provider.name} failed: ${err.message}`);
      if (isFirst && !current) throw err;
      chain.push(`${provider.name} (skipped)`);
    }
  }

  return { result: current, providerChain: chain };
}
