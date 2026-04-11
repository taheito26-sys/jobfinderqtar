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
      if (!userKey) throw new Error("Anthropic API key not configured.");
      return { provider, apiKey: userKey, url: "https://api.anthropic.com/v1/messages", model: "claude-sonnet-4-20250514" };
    case "openai":
      if (!userKey) throw new Error("OpenAI API key not configured.");
      return { provider, apiKey: userKey, url: "https://api.openai.com/v1/chat/completions", model: "gpt-4o" };
    case "gemini":
      if (!userKey) throw new Error("Google API key not configured.");
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
    name: "extract_linkedin_profile",
    description: "Extract structured professional profile data from LinkedIn profile page content.",
    parameters: {
      type: "object",
      properties: {
        full_name: { type: "string" },
        headline: { type: "string" },
        summary: { type: "string" },
        location: { type: "string" },
        country: { type: "string" },
        skills: { type: "array", items: { type: "string" } },
        desired_titles: { type: "array", items: { type: "string" }, description: "3-5 job titles this person would search for" },
        employment: {
          type: "array",
          items: {
            type: "object",
            properties: {
              title: { type: "string" },
              company: { type: "string" },
              location: { type: "string" },
              start_date: { type: "string" },
              end_date: { type: "string" },
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
            required: ["name"]
          }
        }
      },
      required: ["full_name", "skills", "employment", "education"],
      additionalProperties: false
    }
  }
};

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

    const { linkedin_url } = await req.json();
    if (!linkedin_url) {
      return new Response(JSON.stringify({ error: "linkedin_url is required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Validate LinkedIn URL
    const urlNorm = linkedin_url.trim().toLowerCase();
    if (!urlNorm.includes("linkedin.com/in/")) {
      return new Response(JSON.stringify({ error: "Please provide a valid LinkedIn profile URL (e.g. https://linkedin.com/in/yourname)" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Use Firecrawl to scrape LinkedIn
    const firecrawlKey = Deno.env.get("FIRECRAWL_API_KEY");
    if (!firecrawlKey) {
      return new Response(JSON.stringify({ error: "Firecrawl not configured. Please set up Firecrawl in Settings." }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let formattedUrl = linkedin_url.trim();
    if (!formattedUrl.startsWith("http")) formattedUrl = `https://${formattedUrl}`;

    console.log("Scraping LinkedIn profile:", formattedUrl);

    const scrapeResponse = await fetch("https://api.firecrawl.dev/v1/scrape", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${firecrawlKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        url: formattedUrl,
        formats: ["markdown"],
        onlyMainContent: true,
      }),
    });

    const scrapeData = await scrapeResponse.json();
    if (!scrapeResponse.ok) {
      console.error("Firecrawl error:", scrapeData);
      return new Response(JSON.stringify({ error: "Failed to scrape LinkedIn profile. It may be private or the URL is incorrect." }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const markdown = scrapeData.data?.markdown || scrapeData.markdown || "";
    if (!markdown || markdown.length < 100) {
      return new Response(JSON.stringify({ error: "Could not extract enough content from the LinkedIn profile. It may be private." }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`Scraped ${markdown.length} chars from LinkedIn`);

    // Use AI to extract structured data
    const aiConfig = await getAIConfig(user.id);

    const systemPrompt = `You are a LinkedIn profile parser. Extract ONLY facts present in the scraped content.
RULES:
- Never fabricate data
- Use YYYY-MM-DD for dates; if only month/year, use YYYY-MM-01
- For desired_titles: infer 3-5 job titles from current/recent roles
- Extract all experience, education, and certifications found`;

    const body: any = {
      model: aiConfig.model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `Parse this LinkedIn profile:\n\n${markdown.substring(0, 20000)}` },
      ],
      tools: [extractProfileTool],
      tool_choice: { type: "function", function: { name: "extract_linkedin_profile" } },
    };

    let aiResponse;
    if (aiConfig.provider === "anthropic") {
      const anthropicBody = {
        model: aiConfig.model, max_tokens: 8192, system: systemPrompt,
        messages: [{ role: "user", content: `Parse this LinkedIn profile:\n\n${markdown.substring(0, 20000)}` }],
        tools: [{ name: "extract_linkedin_profile", description: extractProfileTool.function.description, input_schema: extractProfileTool.function.parameters }],
        tool_choice: { type: "tool", name: "extract_linkedin_profile" },
      };
      aiResponse = await fetch(aiConfig.url, {
        method: "POST",
        headers: { "x-api-key": aiConfig.apiKey, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
        body: JSON.stringify(anthropicBody),
      });
    } else {
      aiResponse = await fetch(aiConfig.url, {
        method: "POST",
        headers: { Authorization: `Bearer ${aiConfig.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    }

    if (!aiResponse.ok) {
      const errText = await aiResponse.text();
      console.error("AI error:", aiResponse.status, errText);
      throw new Error(`AI processing failed: ${aiResponse.status}`);
    }

    const aiData = await aiResponse.json();
    let parsed;

    if (aiConfig.provider === "anthropic") {
      const toolUse = aiData.content?.find((c: any) => c.type === "tool_use");
      parsed = toolUse ? toolUse.input : JSON.parse(aiData.content?.find((c: any) => c.type === "text")?.text || "{}");
    } else {
      const toolCall = aiData.choices?.[0]?.message?.tool_calls?.[0];
      parsed = toolCall ? JSON.parse(toolCall.function.arguments) : JSON.parse(aiData.choices?.[0]?.message?.content || "{}");
    }

    // Add the LinkedIn URL
    parsed.linkedin_url = formattedUrl;

    return new Response(JSON.stringify({ success: true, parsed }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("scrape-linkedin error:", err);
    return new Response(JSON.stringify({ error: err.message || "Unknown error" }), {
      status: err.status || 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
