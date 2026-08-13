/**
 * gmail-scan-jobs edge function
 *
 * Scans the user's Gmail for job-alert digests (NaukriGulf, LinkedIn, Bayt,
 * GulfTalent), parses the jobs they list, and imports new ones.
 *
 * Request body:
 *   { days?: number, limit?: number, dryRun?: boolean }
 *
 * Response:
 *   { success, messages_scanned, jobs_found, jobs_imported, jobs_skipped, results[] }
 *
 * Digests are region-wide, so roles outside Qatar are imported but flagged
 * (is_local=false, country set) rather than dropped — a strong Dubai role stays
 * visible while profile scoring ranks Qatar roles above it.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import {
  buildJobAlertQuery,
  getMessage,
  listMessageIds,
  refreshAccessToken,
} from "../_shared/gmail-client.ts";
import { parseJobEmail, type ParsedEmailJob } from "../_shared/email-job-parsers.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/** Match how the rest of the app dedupes: same user, same job. */
async function isDuplicate(
  admin: ReturnType<typeof createClient>,
  userId: string,
  job: ParsedEmailJob,
): Promise<boolean> {
  if (job.apply_url) {
    const base = job.apply_url.split("?")[0];
    const { data } = await admin
      .from("jobs")
      .select("id")
      .eq("user_id", userId)
      .ilike("apply_url", `${base}%`)
      .maybeSingle();
    if (data) return true;
  }

  // Digests often carry no link, so fall back to title + company.
  const { data: byIdentity } = await admin
    .from("jobs")
    .select("id")
    .eq("user_id", userId)
    .ilike("title", job.title)
    .ilike("company", job.company)
    .maybeSingle();

  return !!byIdentity;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Missing authorization" }, 401);

    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );

    const { data: { user }, error: authError } = await supabaseClient.auth.getUser();
    if (authError || !user) return json({ error: "Unauthorized" }, 401);

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const body = await req.json().catch(() => ({}));
    const days = Math.min(Math.max(Number(body?.days) || 14, 1), 90);
    const limit = Math.min(Math.max(Number(body?.limit) || 25, 1), 100);
    const dryRun = body?.dryRun === true;

    // ── Load the grant ──────────────────────────────────────────────────────
    const { data: connection } = await admin
      .from("gmail_connections")
      .select("refresh_token")
      .eq("user_id", user.id)
      .maybeSingle();

    if (!connection?.refresh_token) {
      return json({ error: "Gmail is not connected", code: "not_connected" }, 400);
    }

    let accessToken: string;
    try {
      const tokens = await refreshAccessToken(connection.refresh_token as string);
      accessToken = tokens.access_token;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      // A revoked grant cannot be recovered without re-consent.
      await admin
        .from("gmail_connections")
        .update({ last_scan_status: "error", last_scan_message: message })
        .eq("user_id", user.id);
      return json({ error: "Gmail access expired — reconnect Gmail", detail: message }, 401);
    }

    // ── Scan ────────────────────────────────────────────────────────────────
    const query = buildJobAlertQuery(days);
    console.log(`[gmail-scan] user=${user.id} query="${query}" limit=${limit}`);

    const messageIds = await listMessageIds(accessToken, query, limit);
    console.log(`[gmail-scan] ${messageIds.length} candidate messages`);

    // Skip messages already processed in an earlier scan.
    const { data: seenRows } = await admin
      .from("gmail_scanned_messages")
      .select("message_id")
      .eq("user_id", user.id)
      .in("message_id", messageIds.length > 0 ? messageIds : ["__none__"]);

    const seen = new Set((seenRows || []).map((row) => row.message_id as string));
    const pending = messageIds.filter((id) => !seen.has(id));

    let jobsFound = 0;
    let jobsImported = 0;
    let jobsSkipped = 0;
    const results: Array<Record<string, unknown>> = [];

    for (const messageId of pending) {
      const message = await getMessage(accessToken, messageId);
      if (!message) continue;

      const { jobs, parser } = parseJobEmail({
        from: message.from,
        subject: message.subject,
        text: message.text,
        html: message.html,
      });

      jobsFound += jobs.length;
      let importedFromMessage = 0;

      for (const job of jobs) {
        if (!job.title || !job.company) continue;

        if (await isDuplicate(admin, user.id, job)) {
          jobsSkipped++;
          continue;
        }

        if (dryRun) {
          importedFromMessage++;
          continue;
        }

        const { error: insertError } = await admin.from("jobs").insert({
          user_id: user.id,
          title: job.title,
          company: job.company,
          location: job.location,
          country: job.country,
          is_local: job.is_qatar,
          apply_url: job.apply_url,
          source_url: job.apply_url,
          source_platform: `email:${job.source_platform}`,
          description: job.experience ? `Experience: ${job.experience}` : "",
          raw_data: {
            source: "gmail",
            parser,
            gmail_message_id: messageId,
            sender: message.from,
            subject: message.subject,
            posted_hint: job.posted_hint,
          },
        });

        if (insertError) {
          console.error(`[gmail-scan] Insert failed for "${job.title}":`, insertError.message);
          continue;
        }
        importedFromMessage++;
      }

      jobsImported += importedFromMessage;
      results.push({
        message_id: messageId,
        sender: message.from,
        subject: message.subject,
        parser,
        jobs_found: jobs.length,
        jobs_imported: importedFromMessage,
      });

      if (!dryRun) {
        await admin.from("gmail_scanned_messages").insert({
          user_id: user.id,
          message_id: messageId,
          sender: message.from,
          subject: message.subject,
          parser,
          jobs_found: jobs.length,
          jobs_imported: importedFromMessage,
        });
      }
    }

    if (!dryRun) {
      await admin
        .from("gmail_connections")
        .update({
          last_scanned_at: new Date().toISOString(),
          last_scan_status: "ok",
          last_scan_message: `Imported ${jobsImported} job(s) from ${pending.length} email(s)`,
          jobs_imported: jobsImported,
          updated_at: new Date().toISOString(),
        })
        .eq("user_id", user.id);
    }

    console.log(
      `[gmail-scan] scanned=${pending.length} found=${jobsFound} imported=${jobsImported} skipped=${jobsSkipped}`,
    );

    return json({
      success: true,
      dry_run: dryRun,
      messages_scanned: pending.length,
      messages_already_seen: messageIds.length - pending.length,
      jobs_found: jobsFound,
      jobs_imported: jobsImported,
      jobs_skipped: jobsSkipped,
      results,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[gmail-scan] Failure:", message);
    return json({ error: message }, 500);
  }
});
