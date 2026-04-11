import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { document_id } = await req.json();
    if (!document_id) {
      return new Response(
        JSON.stringify({ error: "document_id is required" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const { data: doc, error: docError } = await supabase
      .from("master_documents")
      .select("*")
      .eq("id", document_id)
      .eq("user_id", user.id)
      .single();

    if (docError || !doc) {
      return new Response(JSON.stringify({ error: "Document not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: fileData, error: dlError } = await supabase.storage
      .from("documents")
      .download(doc.file_path);

    if (dlError || !fileData) {
      return new Response(
        JSON.stringify({ error: "Could not download file" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const fileText = await fileData.text();

    const apiKey = Deno.env.get("LOVABLE_API_KEY");
    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: "AI API key not configured" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

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

IMPORTANT for desired_titles: Infer 3-5 job titles this person would likely be searching for based on their experience, current role, skills, and seniority level. For example, if they are a "Senior Software Engineer", suggest titles like "Senior Software Engineer", "Lead Software Engineer", "Staff Engineer", "Software Architect", "Engineering Manager".

CV Text:
${fileText.substring(0, 15000)}`;

    const aiResponse = await fetch(
      "https://ai.gateway.lovable.dev/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-3-flash-preview",
          messages: [
            {
              role: "system",
              content:
                "You are a CV parser. Extract structured data from resume text. Return ONLY valid JSON, no markdown.",
            },
            { role: "user", content: prompt },
          ],
          temperature: 0.1,
        }),
      }
    );

    if (!aiResponse.ok) {
      const err = await aiResponse.text();
      console.error("AI API error:", err);
      return new Response(
        JSON.stringify({ error: "AI parsing failed" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const aiData = await aiResponse.json();
    const rawContent =
      aiData.choices?.[0]?.message?.content || "{}";
    
    const cleaned = rawContent
      .replace(/```json\n?/g, "")
      .replace(/```\n?/g, "")
      .trim();
    
    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      return new Response(
        JSON.stringify({ error: "Failed to parse AI response", raw: cleaned }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Store parsed content on the document
    await supabase
      .from("master_documents")
      .update({ parsed_content: parsed })
      .eq("id", document_id);

    return new Response(JSON.stringify({ success: true, parsed }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("parse-cv error:", err);
    return new Response(
      JSON.stringify({ error: err.message }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
