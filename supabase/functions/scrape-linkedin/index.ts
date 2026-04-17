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
    description: "Extract structured professional profile data from LinkedIn profile content.",
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
              title: { type: "string" }, company: { type: "string" }, location: { type: "string" },
              start_date: { type: "string" }, end_date: { type: "string" },
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
            required: ["name"]
          }
        }
      },
      required: ["full_name", "skills", "employment", "education"],
      additionalProperties: false
    }
  }
};

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

// Browser-exporter style DOM extraction, inspired by public LinkedIn profile tools such as joshuatz/linkedin-to-jsonresume.
function extractLinkedInTextFromHtml(html: string): string {
  const getMetaContent = (pattern: RegExp) => {
    const match = html.match(pattern);
    return match?.[1]?.trim() || "";
  };

  const title =
    getMetaContent(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["'][^>]*>/i) ||
    getMetaContent(/<title[^>]*>([^<]+)<\/title>/i) ||
    "";
  const description =
    getMetaContent(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["'][^>]*>/i) ||
    getMetaContent(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["'][^>]*>/i) ||
    "";

  const bodyText = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ");

  return collapseWhitespace(
    [title ? `Title: ${title}` : "", description ? `Description: ${description}` : "", bodyText]
      .filter(Boolean)
      .join("\n\n"),
  ).substring(0, 20000);
}

function looksLikeLoginWall(html: string): boolean {
  const lower = html.toLowerCase();
  return lower.includes("linkedin") && lower.includes("sign in");
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

    const { linkedin_text, linkedin_url } = await req.json();
    const trimmedText = typeof linkedin_text === "string" ? linkedin_text.trim() : "";
    const trimmedUrl = typeof linkedin_url === "string" ? linkedin_url.trim() : "";

    let formattedUrl = "";
    if (trimmedUrl) {
      const urlNorm = trimmedUrl.toLowerCase();
      if (!urlNorm.includes("linkedin.com/in/")) {
        return new Response(JSON.stringify({ error: "Please provide a valid LinkedIn profile URL (for example, https://linkedin.com/in/yourname)." }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      formattedUrl = trimmedUrl.startsWith("http") ? trimmedUrl : `https://${trimmedUrl}`;
    }

    let textContent = "";

    if (formattedUrl) {
      console.log("Fetching LinkedIn profile page:", formattedUrl);
      try {
        const pageResponse = await fetch(formattedUrl, {
          headers: {
            accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "accept-language": "en-US,en;q=0.9",
            "cache-control": "no-cache",
            pragma: "no-cache",
            "user-agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
          },
        });

        if (pageResponse.ok) {
          const html = await pageResponse.text();
          const extracted = extractLinkedInTextFromHtml(html);
          if (extracted.length >= 100 && !looksLikeLoginWall(html)) {
            textContent = extracted;
            console.log(`Extracted ${textContent.length} chars from LinkedIn HTML`);
          } else if (!trimmedText) {
            return new Response(JSON.stringify({ error: "Could not extract enough content from the LinkedIn profile. It may be private or require sign-in." }), {
              status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }
        } else {
          console.error("LinkedIn fetch failed:", pageResponse.status, pageResponse.statusText);
          if (!trimmedText) {
            return new Response(JSON.stringify({ error: "Failed to fetch the LinkedIn profile page. It may be private, blocked, or the URL is incorrect." }), {
              status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }
        }
      } catch (fetchError) {
        console.error("LinkedIn fetch error:", fetchError);
        if (!trimmedText) {
          return new Response(JSON.stringify({ error: "Failed to fetch the LinkedIn profile page. You can paste the profile text as a fallback." }), {
            status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      }
    }

    if (!textContent && trimmedText) {
      textContent = trimmedText.substring(0, 20000);
      console.log(`Parsing pasted LinkedIn text: ${textContent.length} chars`);
    }

    if (!textContent || textContent.length < 100) {
      return new Response(JSON.stringify({ error: "Could not extract enough LinkedIn content to parse. Provide a public profile URL or paste the LinkedIn profile text." }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const aiConfig = await getAIConfig(user.id);

    const systemPrompt = `You are a LinkedIn profile parser. Extract ONLY facts present in the provided LinkedIn content.
RULES:
- Never fabricate data
- Use YYYY-MM-DD for dates; if only month/year, use YYYY-MM-01
- For desired_titles: infer 3-5 job titles from current/recent roles
- Extract all experience, education, and certifications found`;

    const userPrompt = `Parse this LinkedIn profile content:\n\n${textContent}`;

    let rawResult: string;

    if (aiConfig.provider === "anthropic") {
      const body = {
        model: aiConfig.model, max_tokens: 8192, system: systemPrompt,
        messages: [{ role: "user", content: userPrompt }],
        tools: [{ name: "extract_linkedin_profile", description: extractProfileTool.function.description, input_schema: extractProfileTool.function.parameters }],
        tool_choice: { type: "tool", name: "extract_linkedin_profile" },
      };
      const response = await fetch(aiConfig.url, {
        method: "POST",
        headers: { "x-api-key": aiConfig.apiKey, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) { const err = await response.text(); console.error("AI error:", err); throw new Error(`AI error: ${response.status}`); }
      const data = await response.json();
      const toolUse = data.content?.find((c: any) => c.type === "tool_use");
      if (!toolUse) throw new Error("No structured data returned from AI");
      rawResult = JSON.stringify(toolUse.input);
    } else {
      const body = {
        model: aiConfig.model,
        messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }],
        tools: [extractProfileTool],
        tool_choice: { type: "function", function: { name: "extract_linkedin_profile" } },
      };
      const response = await fetch(aiConfig.url, {
        method: "POST",
        headers: { Authorization: `Bearer ${aiConfig.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) { const errText = await response.text(); console.error("AI error:", response.status, errText); throw new Error(`AI error: ${response.status}`); }
      const data = await response.json();
      const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
      rawResult = toolCall ? toolCall.function.arguments : (data.choices?.[0]?.message?.content || "{}");
    }

    const parsed = JSON.parse(rawResult);
    if (formattedUrl) parsed.linkedin_url = formattedUrl;
    else if (trimmedText && trimmedUrl) parsed.linkedin_url = trimmedUrl;

    console.log(`Extracted: name="${parsed.full_name}", ${(parsed.skills || []).length} skills, ${(parsed.employment || []).length} jobs`);

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
