type FunctionErrorLike = {
  message?: string;
  context?: unknown;
};

async function readResponseBody(response: Response): Promise<string> {
  try {
    const cloned = response.clone();
    const json = await cloned.json();
    if (json && typeof json === 'object') {
      const payload = json as Record<string, unknown>;
      if (typeof payload.error === 'string' && payload.error.trim()) return payload.error.trim();
      if (typeof payload.message === 'string' && payload.message.trim()) return payload.message.trim();
    }
  } catch {
    // Ignore JSON parse failures and fall through to text.
  }

  try {
    const text = await response.clone().text();
    return text.trim();
  } catch {
    return '';
  }
}

export async function getSupabaseFunctionErrorMessage(
  error: unknown,
  fallback = 'The request failed.',
): Promise<string> {
  if (!error || typeof error !== 'object') return fallback;

  const err = error as FunctionErrorLike;
  const message = typeof err.message === 'string' ? err.message.trim() : '';

  if (err.context instanceof Response) {
    const bodyMessage = await readResponseBody(err.context);
    if (bodyMessage) return bodyMessage;
  }

  if (message && message !== 'Edge Function returned a non-2xx status code') {
    return message;
  }

  return fallback;
}
