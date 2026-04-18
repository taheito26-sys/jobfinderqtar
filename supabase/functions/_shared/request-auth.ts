import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

export type RequestAuthResult = {
  userId: string;
  isInternal: boolean;
  body: Record<string, unknown>;
};

export async function resolveRequestAuth(req: Request): Promise<RequestAuthResult> {
  const body = (await req.clone().json().catch(() => ({}))) as Record<string, unknown>;
  const authHeader = req.headers.get("Authorization");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.slice("Bearer ".length).trim();

    // Internal server-to-server calls use the service role key directly.
    if (serviceRoleKey && token === serviceRoleKey) {
      const bodyUserId = typeof body.user_id === "string" ? body.user_id : null;
      if (!bodyUserId) throw new Error("Missing user_id for internal service call");
      return { userId: bodyUserId, isInternal: true, body };
    }

    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: { user }, error: authError } = await supabaseClient.auth.getUser();
    if (authError || !user) throw new Error("Unauthorized");
    return { userId: user.id, isInternal: false, body };
  }

  const bodyUserId = typeof body.user_id === "string" ? body.user_id : null;
  if (!bodyUserId) throw new Error("Missing user_id for system call");
  return { userId: bodyUserId, isInternal: true, body };
}
