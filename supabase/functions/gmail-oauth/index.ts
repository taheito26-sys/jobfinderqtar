/**
 * gmail-oauth edge function
 *
 * Manages the Google OAuth grant used to scan job-alert emails.
 *
 * Flow (all steps authenticated with the caller's Supabase JWT):
 *   1. { action: "authorize", redirectUri }  -> consent URL to send the user to
 *   2. { action: "callback", code, redirectUri } -> exchanges the code, stores
 *      the refresh token server-side
 *   3. { action: "status" }     -> connection state for the settings UI
 *   4. { action: "disconnect" } -> revokes at Google and deletes the row
 *
 * The code exchange is deliberately NOT a public redirect endpoint: Google
 * redirects back to the app itself, and the authenticated frontend posts the
 * code here. That keeps the client secret server-side while ensuring the grant
 * can only ever be attached to the user who initiated it.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import {
  GMAIL_SCOPE,
  exchangeCodeForTokens,
  getProfileEmail,
} from "../_shared/gmail-client.ts";

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

    // Writes to gmail_connections are service-role only.
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const body = await req.json().catch(() => ({}));
    const action = String(body?.action || "status");

    // ── 1. Build the consent URL ────────────────────────────────────────────
    if (action === "authorize") {
      const clientId = Deno.env.get("GOOGLE_CLIENT_ID");
      if (!clientId) {
        return json({
          error: "Gmail is not configured",
          detail: "GOOGLE_CLIENT_ID is not set on the project.",
        }, 500);
      }

      const redirectUri = String(body?.redirectUri || "");
      if (!redirectUri) return json({ error: "redirectUri is required" }, 400);

      const params = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: "code",
        scope: GMAIL_SCOPE,
        // offline + consent are both required to be issued a refresh token.
        access_type: "offline",
        prompt: "consent",
        include_granted_scopes: "true",
        state: user.id,
      });

      return json({
        success: true,
        url: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`,
      });
    }

    // ── 2. Exchange the code and store the grant ────────────────────────────
    if (action === "callback") {
      const code = String(body?.code || "");
      const redirectUri = String(body?.redirectUri || "");
      if (!code || !redirectUri) {
        return json({ error: "code and redirectUri are required" }, 400);
      }

      const tokens = await exchangeCodeForTokens(code, redirectUri);
      if (!tokens.refresh_token) {
        // Google only returns a refresh token on first consent; re-prompting
        // with prompt=consent forces a new one.
        return json({
          error: "Google did not return a refresh token",
          detail: "Remove the app at myaccount.google.com/permissions and connect again.",
        }, 400);
      }

      const emailAddress = await getProfileEmail(tokens.access_token).catch(() => "");

      const { error: upsertError } = await admin
        .from("gmail_connections")
        .upsert({
          user_id: user.id,
          email_address: emailAddress,
          refresh_token: tokens.refresh_token,
          access_token: tokens.access_token,
          access_token_expires_at: new Date(
            Date.now() + (tokens.expires_in ?? 3600) * 1000,
          ).toISOString(),
          scope: tokens.scope || GMAIL_SCOPE,
          last_scan_status: "pending",
          updated_at: new Date().toISOString(),
        }, { onConflict: "user_id" });

      if (upsertError) {
        console.error("[gmail-oauth] Failed to store connection:", upsertError.message);
        return json({ error: "Could not save the Gmail connection" }, 500);
      }

      console.log(`[gmail-oauth] Connected ${emailAddress} for user ${user.id}`);
      return json({ success: true, email_address: emailAddress });
    }

    // ── 3. Status for the settings UI ───────────────────────────────────────
    if (action === "status") {
      const { data } = await admin
        .from("gmail_connections")
        .select(
          "email_address, last_scanned_at, last_scan_status, last_scan_message, jobs_imported, connected_at",
        )
        .eq("user_id", user.id)
        .maybeSingle();

      return json({ success: true, connected: !!data, connection: data ?? null });
    }

    // ── 4. Disconnect ───────────────────────────────────────────────────────
    if (action === "disconnect") {
      const { data } = await admin
        .from("gmail_connections")
        .select("refresh_token")
        .eq("user_id", user.id)
        .maybeSingle();

      // Revoke at Google so access ends immediately, not just locally.
      if (data?.refresh_token) {
        await fetch(
          `https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(data.refresh_token)}`,
          { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" } },
        ).catch((err) => console.warn("[gmail-oauth] Revoke failed:", err?.message));
      }

      await admin.from("gmail_connections").delete().eq("user_id", user.id);
      return json({ success: true });
    }

    return json({ error: `Unknown action: ${action}` }, 400);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[gmail-oauth] Failure:", message);
    return json({ error: message }, 500);
  }
});
