export type AuthDebugInfo = {
  supabaseUrl: string | null;
  supabaseHost: string | null;
  projectRef: string | null;
  uiAuthMethods: Array<{
    key: 'password' | 'linkedin_oidc';
    label: string;
    enabledInUi: boolean;
  }>;
};

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;

function parseSupabaseUrl(rawUrl: string | undefined): { host: string | null; projectRef: string | null } {
  if (!rawUrl) return { host: null, projectRef: null };

  try {
    const url = new URL(rawUrl);
    const host = url.host;
    const projectRef = host.endsWith('.supabase.co') ? host.replace('.supabase.co', '') : null;

    return { host, projectRef };
  } catch {
    return { host: null, projectRef: null };
  }
}

export function getAuthDebugInfo(): AuthDebugInfo {
  const { host, projectRef } = parseSupabaseUrl(SUPABASE_URL);

  return {
    supabaseUrl: SUPABASE_URL ?? null,
    supabaseHost: host,
    projectRef,
    uiAuthMethods: [
      { key: 'password', label: 'Email + password sign-in', enabledInUi: true },
      { key: 'linkedin_oidc', label: 'Continue with LinkedIn', enabledInUi: true },
    ],
  };
}

export function formatAuthBackendLabel(info: AuthDebugInfo): string {
  if (!info.supabaseHost) return 'Unknown Supabase backend';
  if (info.projectRef) return `${info.supabaseHost} (${info.projectRef})`;
  return info.supabaseHost;
}
