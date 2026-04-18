import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("No authorization header");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) throw new Error("Unauthorized");

    // Get user's AI preferences
    const { data: prefs } = await supabase
      .from("user_preferences").select("key, value")
      .eq("user_id", user.id).in("key", ["ai_provider", "ai_api_key"]);

    const prefMap: Record<string, string> = {};
    (prefs || []).forEach((p: any) => { prefMap[p.key] = p.value; });
    const provider = prefMap["ai_provider"] || "openai";
    const userKey = prefMap["ai_api_key"] || "";

    let url: string;
    let model: string;
    let headers: Record<string, string>;
    let body: string;

    switch (provider) {
      case "anthropic": {
        if (!userKey) throw new Error("Anthropic API key not configured. Add your key above.");
        url = "https://api.anthropic.com/v1/messages";
        model = "claude-sonnet-4-20250514";
        headers = { "x-api-key": userKey, "anthropic-version": "2023-06-01", "Content-Type": "application/json" };
        body = JSON.stringify({
          model,
          max_tokens: 50,
          messages: [{ role: "user", content: "Reply with exactly: CONNECTION_OK" }],
        });
        break;
      }
      case "openai": {
        if (!userKey) throw new Error("OpenAI API key not configured. Add your key above.");
        url = "https://api.openai.com/v1/chat/completions";
        model = "gpt-4o";
        headers = { Authorization: `Bearer ${userKey}`, "Content-Type": "application/json" };
        body = JSON.stringify({
          model,
          max_tokens: 10,
          messages: [{ role: "user", content: "Reply with exactly: CONNECTION_OK" }],
        });
        break;
      }
      case "gemini": {
        if (!userKey) throw new Error("Google API key not configured. Add your key above.");
        url = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";
        model = "gemini-2.5-flash";
        headers = { Authorization: `Bearer ${userKey}`, "Content-Type": "application/json" };
        body = JSON.stringify({
          model,
          max_tokens: 10,
          messages: [{ role: "user", content: "Reply with exactly: CONNECTION_OK" }],
        });
        break;
      }
      default:
        throw new Error(`Unsupported provider "${provider}". Use one of: openai, gemini, anthropic.`);
    }

    const startTime = Date.now();
    const response = await fetch(url, { method: "POST", headers, body });
    const latency = Date.now() - startTime;

    if (!response.ok) {
      const errText = await response.text();
      console.error("AI test error:", response.status, errText);

      if (response.status === 401 || response.status === 403) {
        throw new Error("Invalid API key. Please check your key and try again.");
      }
      if (response.status === 429) {
        // Return 200 with error info so client doesn't crash
        return new Response(JSON.stringify({
          success: false,
          provider,
          model,
          error: "RATE_LIMITED",
          message: "Rate limited. Your API key is valid but you've hit the rate limit. Try again shortly.",
          fallback: true,
        }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({
          success: false,
          provider,
          model,
          error: "PAYMENT_REQUIRED",
          message: "Payment required. Your API key is valid but your account needs credits/billing.",
          fallback: true,
        }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      throw new Error(`API returned ${response.status}. Check your key and account status.`);
    }

    const result = await response.json();

    // Verify we got a real response
    let replyText = "";
    if (provider === "anthropic") {
      replyText = result.content?.[0]?.text || "";
    } else {
      replyText = result.choices?.[0]?.message?.content || "";
    }

    return new Response(JSON.stringify({
      success: true,
      provider,
      model,
      message: `Connection successful (${latency}ms)`,
      latency_ms: latency,
      reply: replyText.trim(),
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("test-ai-connection error:", error);
    return new Response(JSON.stringify({ error: error.message || "Connection test failed" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
