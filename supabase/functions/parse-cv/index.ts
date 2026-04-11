import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { getPipelineConfig, callProvider } from "../_shared/ai-pipeline.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

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
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
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

    const pipelineConfig = await getPipelineConfig(user.id);
    console.log(`[parse-cv] Pipeline: ${pipelineConfig.enabled ? "ON" : "OFF"}, providers: ${pipelineConfig.providers.map(p => p.name).join(" → ")}`);

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
    const providerChain: string[] = [];

    // For parse-cv, we use the pipeline differently:
    // Step 1: First provider extracts (handles multimodal PDF)
    // Step 2+: Subsequent providers review the extracted data for accuracy
    const firstProvider = pipelineConfig.providers[0];
    let userContent: any;

    if (isPdfFile) {
      const arrayBuffer = await fileData.arrayBuffer();
      const base64 = arrayBufferToBase64(arrayBuffer);
      console.log(`Sending PDF as base64 (${Math.round(base64.length / 1024)}KB) to ${firstProvider.name}`);

      if (firstProvider.provider === "anthropic") {
        userContent = [
          { type: "document", source: { type: "base64", media_type: "application/pdf", data: base64 } },
          { type: "text", text: "Parse this CV/resume and extract all professional data. The person's name should match what's written on the document." }
        ];
      } else {
        userContent = [
          { type: "text", text: "Parse this CV/resume and extract all professional data. The person's name should match what's written on the document." },
          { type: "image_url", image_url: { url: `data:application/pdf;base64,${base64}` } }
        ];
      }
    } else {
      const fileText = await fileData.text();
      userContent = `Parse this CV/resume and extract all professional data:\n\n${fileText.substring(0, 20000)}`;
    }

    // Step 1: First provider extracts
    const extractResult = await callProvider(
      firstProvider,
      [{ role: "system", content: systemPrompt }, { role: "user", content: userContent }],
      [extractProfileTool],
      { type: "function", function: { name: "extract_profile" } },
      8192
    );
    let parsed = JSON.parse(extractResult.tool_arguments);
    providerChain.push(firstProvider.name);

    // Steps 2+: Review providers verify extraction accuracy
    if (pipelineConfig.enabled && pipelineConfig.providers.length > 1) {
      for (let i = 1; i < pipelineConfig.providers.length; i++) {
        const reviewer = pipelineConfig.providers[i];
        const isLast = i === pipelineConfig.providers.length - 1;
        const role = isLast ? "FINAL REVIEWER" : "REVIEWER";

        console.log(`[parse-cv] Step ${i + 1}: ${reviewer.name} (${role})`);

        try {
          const reviewResult = await callProvider(
            reviewer,
            [
              { role: "system", content: systemPrompt },
              {
                role: "user",
                content: `You are the ${role} in a multi-AI extraction pipeline.

Review this extracted CV data for accuracy and completeness:
${JSON.stringify(parsed, null, 2)}

Original document text (for verification):
${typeof userContent === "string" ? userContent.substring(0, 5000) : "PDF document (verify against the extracted data consistency)"}

Check:
1. Is the name correct?
2. Are all employment entries present and accurate?
3. Are dates in correct format?
4. Are skills actually mentioned?
5. Fix any errors and return the corrected extraction.`
              },
            ],
            [extractProfileTool],
            { type: "function", function: { name: "extract_profile" } },
            8192
          );
          parsed = JSON.parse(reviewResult.tool_arguments);
          providerChain.push(reviewer.name);
        } catch (err: any) {
          console.warn(`[parse-cv] ${reviewer.name} review failed: ${err.message}. Skipping.`);
          providerChain.push(`${reviewer.name} (skipped)`);
        }
      }
    }

    console.log(`[parse-cv] Chain: ${providerChain.join(" → ")} — name="${parsed.full_name}", ${(parsed.skills || []).length} skills, ${(parsed.employment || []).length} jobs`);

    await supabase.from("master_documents").update({ parsed_content: parsed }).eq("id", document_id);

    return new Response(JSON.stringify({ success: true, parsed, ai_chain: providerChain }), {
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
