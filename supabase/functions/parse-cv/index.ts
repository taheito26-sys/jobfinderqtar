import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface AIConfig {
  provider: string;
  apiKey: string;
  url: string;
  model: string;
}

async function getAIConfig(userId: string): Promise<AIConfig> {
  const supabaseAdmin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );
  const { data: prefs } = await supabaseAdmin
    .from("user_preferences").select("key, value")
    .eq("user_id", userId).in("key", ["ai_provider", "ai_api_key"]);

  const prefMap: Record<string, string> = {};
  (prefs || []).forEach((p: any) => { prefMap[p.key] = p.value; });
  const provider = prefMap["ai_provider"] || "lovable";
  const userKey = prefMap["ai_api_key"] || "";

  switch (provider) {
    case "anthropic":
      if (!userKey) throw new Error("Anthropic API key not configured. Go to Settings.");
      return { provider, apiKey: userKey, url: "https://api.anthropic.com/v1/messages", model: "claude-sonnet-4-20250514" };
    case "openai":
      if (!userKey) throw new Error("OpenAI API key not configured. Go to Settings.");
      return { provider, apiKey: userKey, url: "https://api.openai.com/v1/chat/completions", model: "gpt-4o" };
    case "gemini":
      if (!userKey) throw new Error("Google API key not configured. Go to Settings.");
      return { provider, apiKey: userKey, url: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", model: "gemini-2.5-flash" };
    default: {
      const lovableKey = Deno.env.get("LOVABLE_API_KEY");
      if (!lovableKey) throw new Error("LOVABLE_API_KEY not configured");
      return { provider: "lovable", apiKey: lovableKey, url: "https://ai.gateway.lovable.dev/v1/chat/completions", model: "google/gemini-3-flash-preview" };
    }
  }
}

const extractProfileTool = {
  type: "function",
  function: {
    name: "extract_profile",
    description: "Extract structured professional profile data from CV/resume text. Only extract facts explicitly present in the text — never invent or hallucinate data.",
    parameters: {
      type: "object",
      properties: {
        full_name: { type: "string", description: "Full name as written in the CV" },
        headline: { type: "string", description: "Current job title or professional headline" },
        summary: { type: "string", description: "Professional summary/objective if present" },
        email: { type: "string", description: "Email address" },
        phone: { type: "string", description: "Phone number" },
        location: { type: "string", description: "City or location" },
        country: { type: "string", description: "Country" },
        linkedin_url: { type: "string", description: "LinkedIn profile URL if present" },
        skills: {
          type: "array", items: { type: "string" },
          description: "Technical and professional skills explicitly listed"
        },
        desired_titles: {
          type: "array", items: { type: "string" },
          description: "3-5 job titles inferred from experience and current role"
        },
        employment: {
          type: "array",
          items: {
            type: "object",
            properties: {
              title: { type: "string" },
              company: { type: "string" },
              location: { type: "string" },
              start_date: { type: "string", description: "YYYY-MM-DD format" },
              end_date: { type: "string", description: "YYYY-MM-DD or null if current" },
              is_current: { type: "boolean" },
              description: { type: "string" },
              achievements: { type: "array", items: { type: "string" } }
            },
            required: ["title", "company"]
          }
        },
        education: {
          type: "array",
          items: {
            type: "object",
            properties: {
              degree: { type: "string" },
              institution: { type: "string" },
              field_of_study: { type: "string" },
              start_date: { type: "string" },
              end_date: { type: "string" }
            },
            required: ["degree", "institution"]
          }
        },
        certifications: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              issuing_organization: { type: "string" },
              issue_date: { type: "string" }
            },
            required: ["name", "issuing_organization"]
          }
        }
      },
      required: ["full_name", "skills", "desired_titles", "employment", "education"],
      additionalProperties: false
    }
  }
};

async function callAIWithTools(config: AIConfig, messages: any[], tools: any[], tool_choice: any): Promise<string> {
  if (config.provider === "anthropic") {
    const systemMsg = messages.find((m: any) => m.role === "system")?.content || "";
    const userMsgs = messages.filter((m: any) => m.role !== "system");
    const body: any = {
      model: config.model, max_tokens: 8192, system: systemMsg, messages: userMsgs,
      tools: tools.map((t: any) => ({ name: t.function.name, description: t.function.description, input_schema: t.function.parameters })),
      tool_choice: { type: "tool", name: tool_choice.function.name },
    };
    const response = await fetch(config.url, {
      method: "POST",
      headers: { "x-api-key": config.apiKey, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) { const err = await response.text(); console.error("Anthropic error:", err); throw new Error(`AI error: ${response.status}`); }
    const data = await response.json();
    const toolUse = data.content?.find((c: any) => c.type === "tool_use");
    if (toolUse) return JSON.stringify(toolUse.input);
    throw new Error("No tool call returned from Anthropic");
  }

  const body: any = { model: config.model, messages, tools, tool_choice };
  const response = await fetch(config.url, {
    method: "POST",
    headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const errText = await response.text();
    console.error("AI error:", response.status, errText);
    if (response.status === 429) throw Object.assign(new Error("Rate limited — please try again in a moment"), { status: 429 });
    if (response.status === 402) throw Object.assign(new Error("AI credits exhausted — add funds in Settings → Workspace → Usage"), { status: 402 });
    throw new Error(`AI error: ${response.status}`);
  }
  const data = await response.json();
  const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
  if (toolCall) return toolCall.function.arguments;
  // Fallback: try to parse content as JSON
  const content = data.choices?.[0]?.message?.content || "{}";
  return content;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const aiConfig = await getAIConfig(user.id);
    console.log(`parse-cv using AI provider: ${aiConfig.provider}`);

    const { document_id } = await req.json();
    if (!document_id) {
      return new Response(JSON.stringify({ error: "document_id is required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: doc, error: docError } = await supabase
      .from("master_documents").select("*").eq("id", document_id).eq("user_id", user.id).single();
    if (docError || !doc) {
      return new Response(JSON.stringify({ error: "Document not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: fileData, error: dlError } = await supabase.storage.from("documents").download(doc.file_path);
    if (dlError || !fileData) {
      return new Response(JSON.stringify({ error: "Could not download file" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const fileText = await fileData.text();
    const truncatedText = fileText.substring(0, 20000);

    const systemPrompt = `You are a precise CV/resume parser. Extract ONLY facts explicitly present in the text.

CRITICAL RULES:
- NEVER invent, fabricate, or hallucinate any data
- If a field is not present in the CV, leave it empty or null
- For dates, use YYYY-MM-DD format. If only a year is given, use YYYY-01-01
- For "desired_titles": infer 3-5 realistic job titles based on the person's most recent role, seniority, and domain
- Extract ALL employment entries, education entries, and certifications found
- Skills should only include those explicitly listed or clearly demonstrated`;

    const userPrompt = `Parse this CV/resume and extract all professional data:\n\n${truncatedText}`;

    const rawResult = await callAIWithTools(
      aiConfig,
      [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }],
      [extractProfileTool],
      { type: "function", function: { name: "extract_profile" } }
    );

    let parsed;
    try {
      parsed = JSON.parse(rawResult);
    } catch {
      // Try to clean markdown fences
      const cleaned = rawResult.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
      parsed = JSON.parse(cleaned);
    }

    // Validation: check that full_name appears in source text
    if (parsed.full_name) {
      const nameNorm = parsed.full_name.toLowerCase().replace(/\s+/g, " ");
      const textNorm = truncatedText.toLowerCase().replace(/\s+/g, " ");
      if (!textNorm.includes(nameNorm)) {
        console.warn(`Validation warning: extracted name "${parsed.full_name}" not found in CV text`);
        parsed._validation_warnings = parsed._validation_warnings || [];
        parsed._validation_warnings.push(`Name "${parsed.full_name}" may be inaccurate — not found verbatim in CV`);
      }
    }

    await supabase.from("master_documents").update({ parsed_content: parsed }).eq("id", document_id);

    return new Response(JSON.stringify({ success: true, parsed }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("parse-cv error:", err);
    const status = err.status || 500;
    return new Response(JSON.stringify({ error: err.message }), {
      status, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
