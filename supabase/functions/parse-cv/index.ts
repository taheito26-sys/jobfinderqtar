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

async function callAIText(config: AIConfig, messages: any[]): Promise<string> {
  if (config.provider === "anthropic") {
    const systemMsg = messages.find((m: any) => m.role === "system")?.content || "";
    const userMsgs = messages.filter((m: any) => m.role !== "system");
    const response = await fetch(config.url, {
      method: "POST",
      headers: { "x-api-key": config.apiKey, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
      body: JSON.stringify({ model: config.model, max_tokens: 8192, system: systemMsg, messages: userMsgs }),
    });
    if (!response.ok) throw new Error(`AI error: ${response.status}`);
    const data = await response.json();
    return data.content?.find((c: any) => c.type === "text")?.text || "{}";
  }

  const response = await fetch(config.url, {
    method: "POST",
    headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: config.model, messages, temperature: 0.1 }),
  });
  if (!response.ok) throw new Error(`AI error: ${response.status}`);
  const data = await response.json();
  return data.choices?.[0]?.message?.content || "{}";
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

    const prompt = `Extract structured professional data from this CV/resume text. Return ONLY valid JSON with this structure:
{
  "full_name": "string",
  "headline": "string (professional headline/title)",
  "summary": "string (professional summary)",
  "email": "string",
  "phone": "string",
  "location": "string (city)",
  "country": "string (country)",
  "skills": ["skill1", "skill2"],
  "desired_titles": ["Job Title 1", "Job Title 2", "Job Title 3"],
  "employment": [
    {
      "title": "string",
      "company": "string",
      "location": "string",
      "start_date": "YYYY-MM-DD",
      "end_date": "YYYY-MM-DD or null if current",
      "is_current": boolean,
      "description": "string",
      "achievements": ["string"]
    }
  ],
  "education": [
    {
      "degree": "string",
      "institution": "string",
      "field_of_study": "string",
      "start_date": "YYYY-MM-DD",
      "end_date": "YYYY-MM-DD"
    }
  ],
  "certifications": [
    {
      "name": "string",
      "issuing_organization": "string",
      "issue_date": "YYYY-MM-DD"
    }
  ]
}

IMPORTANT for desired_titles: Infer 3-5 job titles this person would likely be searching for based on their experience, current role, skills, and seniority level.

CV Text:
${fileText.substring(0, 15000)}`;

    const rawContent = await callAIText(aiConfig, [
      { role: "system", content: "You are a CV parser. Extract structured data from resume text. Return ONLY valid JSON, no markdown." },
      { role: "user", content: prompt },
    ]);

    const cleaned = rawContent.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      return new Response(JSON.stringify({ error: "Failed to parse AI response", raw: cleaned }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    await supabase.from("master_documents").update({ parsed_content: parsed }).eq("id", document_id);

    return new Response(JSON.stringify({ success: true, parsed }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("parse-cv error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});