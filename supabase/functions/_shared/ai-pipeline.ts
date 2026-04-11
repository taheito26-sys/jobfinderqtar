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
  lovable: "google/gemini-3-flash-preview",
  gemini: "gemini-2.5-flash",
  openai: "gpt-4o",
  anthropic: "claude-sonnet-4-20250514",
};

const PROVIDER_URLS: Record<string, string> = {
  lovable: "https://ai.gateway.lovable.dev/v1/chat/completions",
  gemini: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
  openai: "https://api.openai.com/v1/chat/completions",
  anthropic: "https://api.anthropic.com/v1/messages",
};

const PROVIDER_NAMES: Record<string, string> = {
  lovable: "Lovable AI",
  gemini: "Gemini",
  openai: "OpenAI",
  anthropic: "Claude",
};

/** Fetch pipeline config for a user — determines single or multi-provider mode */
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
      "ai_pipeline_enabled",
      "ai_key_anthropic", "ai_key_openai", "ai_key_gemini",
      "ai_model_primary", "ai_model_lovable", "ai_model_openai",
      "ai_model_gemini", "ai_model_anthropic",
    ]);

  const pm: Record<string, string> = {};
  (prefs || []).forEach((p: any) => { pm[p.key] = p.value; });

  const lovableKey = Deno.env.get("LOVABLE_API_KEY") || "";
  const pipelineEnabled = pm["ai_pipeline_enabled"] === "true";

  // Build primary provider
  const primaryName = pm["ai_provider"] || "lovable";
  const primaryKey = primaryName === "lovable" ? lovableKey : (pm["ai_api_key"] || "");
  // Use primary model pref, fall back to provider-specific model pref, fall back to default
  const primaryModel = pm["ai_model_primary"] || pm[`ai_model_${primaryName}`] || DEFAULT_MODELS[primaryName] || DEFAULT_MODELS.lovable;
  const primary = buildProvider(primaryName, primaryKey, lovableKey, primaryModel);

  if (!pipelineEnabled) {
    return { enabled: false, providers: [primary], primary };
  }

  // Build ordered chain: Lovable → Gemini → OpenAI → Claude
  const chain: ProviderConfig[] = [];

  // Always start with Lovable
  if (lovableKey) {
    const model = pm["ai_model_lovable"] || DEFAULT_MODELS.lovable;
    chain.push(buildProvider("lovable", lovableKey, lovableKey, model));
  }

  // Gemini
  const geminiKey = pm["ai_key_gemini"] || "";
  if (geminiKey) {
    const model = pm["ai_model_gemini"] || DEFAULT_MODELS.gemini;
    if (!chain.find(c => c.provider === "gemini")) {
      chain.push(buildProvider("gemini", geminiKey, lovableKey, model));
    }
  }

  // OpenAI
  const openaiKey = pm["ai_key_openai"] || (primaryName === "openai" ? pm["ai_api_key"] : "");
  if (openaiKey) {
    const model = pm["ai_model_openai"] || DEFAULT_MODELS.openai;
    if (!chain.find(c => c.provider === "openai")) {
      chain.push(buildProvider("openai", openaiKey, lovableKey, model));
    }
  }

  // Claude is ALWAYS last (finalizer)
  const anthropicKey = pm["ai_key_anthropic"] || (primaryName === "anthropic" ? pm["ai_api_key"] : "");
  if (anthropicKey) {
    const model = pm["ai_model_anthropic"] || DEFAULT_MODELS.anthropic;
    if (!chain.find(c => c.provider === "anthropic")) {
      chain.push(buildProvider("anthropic", anthropicKey, lovableKey, model));
    }
  }

  if (chain.length <= 1) {
    return { enabled: false, providers: [primary], primary };
  }

  return { enabled: true, providers: chain, primary: chain[chain.length - 1] };
}

function buildProvider(name: string, key: string, lovableKey: string, model?: string): ProviderConfig {
  return {
    name: PROVIDER_NAMES[name] || name,
    provider: name,
    apiKey: name === "lovable" ? lovableKey : key,
    url: PROVIDER_URLS[name] || PROVIDER_URLS.lovable,
    model: model || DEFAULT_MODELS[name] || DEFAULT_MODELS.lovable,
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
 * Run the sequential AI pipeline.
 * Provider 1 drafts → Provider 2 reviews → Claude finalizes.
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

  if (!config.enabled || config.providers.length <= 1) {
    const provider = config.primary;
    console.log(`[Pipeline] Single mode: ${provider.name} (${provider.model})`);
    const result = await callProvider(provider, [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ], tools, toolChoice, maxTokens);
    return { result, providerChain: [`${provider.name} (${provider.model})`] };
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

  if (!config.enabled || config.providers.length <= 1) {
    const provider = config.primary;
    const result = await callProviderText(provider, [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ]);
    return { result, providerChain: [`${provider.name} (${provider.model})`] };
  }

  const chain: string[] = [];
  let currentOutput = "";

  for (let i = 0; i < config.providers.length; i++) {
    const provider = config.providers[i];
    const isFirst = i === 0;
    const isLast = i === config.providers.length - 1;

    let messages: any[];
    if (isFirst) {
      messages = [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ];
    } else {
      const role = isLast ? "FINAL REVIEWER" : "REVIEWER";
      messages = [
        { role: "system", content: systemPrompt },
        { role: "user", content: `You are the ${role}. ${reviewInstruction}\n\nPrevious output:\n${currentOutput}\n\nOriginal request:\n${userPrompt}\n\nReturn the corrected output in the same format.` },
      ];
    }

    try {
      currentOutput = await callProviderText(provider, messages);
      chain.push(`${provider.name} (${provider.model})`);
    } catch (err: any) {
      console.warn(`[Pipeline] ${provider.name} (${provider.model}) failed: ${err.message}. Skipping.`);
      if (isFirst) throw err;
      chain.push(`${provider.name} (skipped)`);
    }
  }

  return { result: currentOutput, providerChain: chain };
}
