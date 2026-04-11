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
    description: "Extract structured professional profile data from CV/resume. Only extract facts explicitly present — never invent data.",
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
        skills: { type: "array", items: { type: "string" }, description: "Technical and professional skills explicitly listed" },
        desired_titles: { type: "array", items: { type: "string" }, description: "3-5 job titles inferred from experience and current role" },
        employment: {
          type: "array",
          items: {
            type: "object",
            properties: {
              title: { type: "string" }, company: { type: "string" }, location: { type: "string" },
              start_date: { type: "string", description: "YYYY-MM-DD format" },
              end_date: { type: "string", description: "YYYY-MM-DD or null if current" },
              is_current: { type: "boolean" }, description: { type: "string" },
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
              degree: { type: "string" }, institution: { type: "string" },
              field_of_study: { type: "string" }, start_date: { type: "string" }, end_date: { type: "string" }
            },
            required: ["degree", "institution"]
          }
        },
        certifications: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string" }, issuing_organization: { type: "string" }, issue_date: { type: "string" }
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

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function isPdf(mimeType: string, fileName: string): boolean {
  return mimeType === "application/pdf" || fileName.toLowerCase().endsWith(".pdf");
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

    const systemPrompt = `You are a precise CV/resume parser. Extract ONLY facts explicitly present in the document.

CRITICAL RULES:
- NEVER invent, fabricate, or hallucinate any data
- The full_name MUST be the actual name shown in the document
- If a field is not present, leave it empty or null
- For dates, use YYYY-MM-DD format. If only a year is given, use YYYY-01-01
- For "desired_titles": infer 3-5 realistic job titles based on the person's most recent role, seniority, and domain
- Extract ALL employment entries, education entries, and certifications found
- Skills should only include those explicitly listed or clearly demonstrated`;

    const isPdfFile = isPdf(doc.mime_type || "", doc.file_name);
    let userContent: any;

    if (isPdfFile) {
      // Send PDF as base64 for multimodal AI processing
      const arrayBuffer = await fileData.arrayBuffer();
      const base64 = arrayBufferToBase64(arrayBuffer);
      console.log(`Sending PDF as base64 (${Math.round(base64.length / 1024)}KB) to AI`);

      if (aiConfig.provider === "anthropic") {
        // Anthropic uses document type for PDFs
        userContent = [
          { type: "document", source: { type: "base64", media_type: "application/pdf", data: base64 } },
          { type: "text", text: "Parse this CV/resume and extract all professional data. The person's name should match what's written on the document." }
        ];
      } else {
        // OpenAI-compatible (Lovable gateway, Gemini, OpenAI) - use image_url with data URI for PDFs
        userContent = [
          { type: "text", text: "Parse this CV/resume and extract all professional data. The person's name should match what's written on the document." },
          { type: "image_url", image_url: { url: `data:application/pdf;base64,${base64}` } }
        ];
      }
    } else {
      // Plain text files
      const fileText = await fileData.text();
      const truncatedText = fileText.substring(0, 20000);
      userContent = `Parse this CV/resume and extract all professional data:\n\n${truncatedText}`;
    }

    // Call AI with tool calling
    let rawResult: string;

    if (aiConfig.provider === "anthropic") {
      const body = {
        model: aiConfig.model, max_tokens: 8192, system: systemPrompt,
        messages: [{ role: "user", content: userContent }],
        tools: [{ name: "extract_profile", description: extractProfileTool.function.description, input_schema: extractProfileTool.function.parameters }],
        tool_choice: { type: "tool", name: "extract_profile" },
      };
      const response = await fetch(aiConfig.url, {
        method: "POST",
        headers: { "x-api-key": aiConfig.apiKey, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) { const err = await response.text(); console.error("Anthropic error:", err); throw new Error(`AI error: ${response.status}`); }
      const data = await response.json();
      const toolUse = data.content?.find((c: any) => c.type === "tool_use");
      if (!toolUse) throw new Error("No tool call returned from AI");
      rawResult = JSON.stringify(toolUse.input);
    } else {
      const body = {
        model: aiConfig.model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userContent },
        ],
        tools: [extractProfileTool],
        tool_choice: { type: "function", function: { name: "extract_profile" } },
      };
      const response = await fetch(aiConfig.url, {
        method: "POST",
        headers: { Authorization: `Bearer ${aiConfig.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        const errText = await response.text();
        console.error("AI error:", response.status, errText);
        throw new Error(`AI error: ${response.status}`);
      }
      const data = await response.json();
      const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
      rawResult = toolCall ? toolCall.function.arguments : (data.choices?.[0]?.message?.content || "{}");
    }

    let parsed;
    try {
      parsed = JSON.parse(rawResult);
    } catch {
      const cleaned = rawResult.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
      parsed = JSON.parse(cleaned);
    }

    console.log(`Extracted: name="${parsed.full_name}", ${(parsed.skills || []).length} skills, ${(parsed.employment || []).length} jobs`);

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
