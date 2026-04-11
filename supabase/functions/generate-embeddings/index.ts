import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function getEmbedding(text: string, apiKey: string): Promise<number[]> {
  // Use Lovable AI Gateway for embeddings (OpenAI-compatible)
  const response = await fetch("https://ai.gateway.lovable.dev/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "openai/text-embedding-3-small",
      input: text.slice(0, 8000), // limit input length
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    console.error("Embedding error:", response.status, err);
    if (response.status === 429) throw Object.assign(new Error("Rate limited"), { status: 429 });
    if (response.status === 402) throw Object.assign(new Error("Credits exhausted"), { status: 402 });
    throw new Error(`Embedding API error: ${response.status}`);
  }

  const data = await response.json();
  return data.data?.[0]?.embedding || [];
}

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

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) throw new Error("Unauthorized");

    const lovableKey = Deno.env.get("LOVABLE_API_KEY");
    if (!lovableKey) throw new Error("LOVABLE_API_KEY not configured");

    const { target, job_id } = await req.json();
    // target: "profile" | "job" | "both"

    const results: any = {};

    if (target === "profile" || target === "both") {
      const [profileRes, skillsRes, empRes] = await Promise.all([
        supabase.from("profiles_v2").select("*").eq("user_id", user.id).single(),
        supabase.from("profile_skills").select("skill_name, proficiency, category").eq("user_id", user.id),
        supabase.from("employment_history").select("title, company, description, achievements, technologies").eq("user_id", user.id).order("start_date", { ascending: false }).limit(5),
      ]);

      const profile = profileRes.data;
      if (!profile) throw new Error("Profile not found");

      const profileText = [
        profile.headline || "",
        profile.summary || "",
        `Skills: ${(skillsRes.data || []).map((s: any) => s.skill_name).join(", ")}`,
        ...(empRes.data || []).map((e: any) =>
          `${e.title} at ${e.company}. ${e.description || ""} ${JSON.stringify(e.achievements || [])}`
        ),
      ].join("\n").trim();

      const embedding = await getEmbedding(profileText, lovableKey);

      // Upsert profile embedding using service role (bypasses RLS for vector type)
      const { error: upsertError } = await supabaseAdmin.from("profile_embeddings").upsert({
        user_id: user.id,
        section: "full",
        embedding: JSON.stringify(embedding),
        model: "text-embedding-3-small",
      }, { onConflict: "user_id,section" });

      if (upsertError) {
        console.error("Profile embedding upsert error:", upsertError);
        // Try insert if upsert fails (no unique constraint)
        await supabaseAdmin.from("profile_embeddings")
          .delete().eq("user_id", user.id).eq("section", "full");
        await supabaseAdmin.from("profile_embeddings").insert({
          user_id: user.id,
          section: "full",
          embedding: JSON.stringify(embedding),
          model: "text-embedding-3-small",
        });
      }

      results.profile = { dimensions: embedding.length, status: "ok" };
      console.log(`Profile embedding generated: ${embedding.length} dimensions`);
    }

    if ((target === "job" || target === "both") && job_id) {
      const { data: job } = await supabase
        .from("jobs").select("*").eq("id", job_id).eq("user_id", user.id).single();

      if (!job) throw new Error("Job not found");

      const jobText = [
        job.title,
        job.company,
        job.description || "",
        `Requirements: ${JSON.stringify(job.requirements || [])}`,
        `Nice to have: ${JSON.stringify(job.nice_to_haves || [])}`,
      ].join("\n").trim();

      const embedding = await getEmbedding(jobText, lovableKey);

      // Upsert job embedding using service role
      await supabaseAdmin.from("job_embeddings")
        .delete().eq("job_id", job_id);
      await supabaseAdmin.from("job_embeddings").insert({
        job_id: job_id,
        embedding: JSON.stringify(embedding),
        model: "text-embedding-3-small",
      });

      results.job = { dimensions: embedding.length, status: "ok" };
      console.log(`Job embedding generated for ${job.title}: ${embedding.length} dimensions`);
    }

    return new Response(JSON.stringify({ success: true, ...results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("generate-embeddings error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: error.status || 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
