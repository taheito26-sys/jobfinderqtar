export type AuthUiErrorCode =
  | 'INVALID_PASSWORD_OR_NO_PASSWORD_ACCOUNT'
  | 'EMAIL_NOT_CONFIRMED'
  | 'OAUTH_PROVIDER_UNAVAILABLE'
  | 'USER_NOT_FOUND_OR_WRONG_PROJECT'
  | 'PASSWORD_RESET_REQUIRED'
  | 'RATE_LIMITED'
  | 'EMAIL_ALREADY_REGISTERED'
  | 'UNKNOWN_AUTH_ERROR';

export type AuthErrorContext =
  | { operation: 'password_sign_in' }
  | { operation: 'signup' }
  | { operation: 'oauth_sign_in'; provider?: string }
  | { operation: 'password_reset' }
  | { operation: 'password_recovery' };

export type AuthUiError = {
  code: AuthUiErrorCode;
  title: string;
  description: string;
  recommendedAction?: string;
  isRecoverable: boolean;
};

type AuthLikeError = {
  message?: string;
  status?: number;
  code?: string;
  name?: string;
};

const normalize = (value: unknown) => String(value ?? '').trim().toLowerCase();

const getAuthLikeError = (error: unknown): AuthLikeError => {
  if (!error || typeof error !== 'object') return {};

  const candidate = error as Record<string, unknown>;
  return {
    message: typeof candidate.message === 'string' ? candidate.message : undefined,
    status: typeof candidate.status === 'number' ? candidate.status : undefined,
    code: typeof candidate.code === 'string' ? candidate.code : undefined,
    name: typeof candidate.name === 'string' ? candidate.name : undefined,
  };
};

const createAuthUiError = (
  code: AuthUiErrorCode,
  title: string,
  description: string,
  recommendedAction?: string,
  isRecoverable = true,
): AuthUiError => ({
  code,
  title,
  description,
  recommendedAction,
  isRecoverable,
});

export function mapSupabaseAuthError(error: unknown, context: AuthErrorContext): AuthUiError {
  const authError = getAuthLikeError(error);
  const message = normalize(authError.message);
  const code = normalize(authError.code);
  const name = normalize(authError.name);
  const status = authError.status;
  const provider = 'provider' in context ? normalize(context.provider) : '';

  if (
    status === 429 ||
    message.includes('too many') ||
    message.includes('rate limit') ||
    message.includes('over_email_send_rate_limit') ||
    code.includes('too_many_requests')
  ) {
    return createAuthUiError(
      'RATE_LIMITED',
      'Too many attempts',
      'Supabase is rate limiting authentication requests for this account or network.',
      'Wait a few minutes and try again.',
    );
  }

  if (
    message.includes('email not confirmed') ||
    message.includes('email_not_confirmed') ||
    message.includes('email needs to be confirmed') ||
    message.includes('not confirmed')
  ) {
    return createAuthUiError(
      'EMAIL_NOT_CONFIRMED',
      'Email not confirmed',
      'This account exists in the current auth backend, but the email address has not been confirmed.',
      'Check the confirmation email or resend verification from the auth backend if that flow is enabled.',
    );
  }

  if (
    context.operation === 'signup' &&
    (message.includes('user already registered') ||
      message.includes('email already registered') ||
      message.includes('already registered') ||
      message.includes('database error saving new user') ||
      code.includes('user_already_exists'))
  ) {
    return createAuthUiError(
      'EMAIL_ALREADY_REGISTERED',
      'Email already registered',
      'This email is already registered in the current auth backend. Try sign-in, LinkedIn, or reset password.',
      'Switch to Sign in and try the existing account path.',
    );
  }

  if (
    context.operation === 'oauth_sign_in' ||
    provider === 'linkedin_oidc' ||
    message.includes('unsupported provider') ||
    message.includes('provider is not enabled') ||
    message.includes('provider not enabled') ||
    message.includes('provider not found') ||
    message.includes('oauth provider') ||
    message.includes('sign in with oauth failed') ||
    code.includes('provider_not_found')
  ) {
    return createAuthUiError(
      'OAUTH_PROVIDER_UNAVAILABLE',
      'LinkedIn sign-in unavailable',
      'The backend auth provider for LinkedIn is not enabled or is not configured correctly.',
      'Enable the LinkedIn provider in Supabase Authentication settings, then retry.',
    );
  }

  if (
    message.includes('password recovery') ||
    message.includes('recovery required') ||
    message.includes('reset required') ||
    message.includes('password reset required') ||
    message.includes('otp expired') ||
    message.includes('invalid or expired') ||
    message.includes('recovery token')
  ) {
    return createAuthUiError(
      'PASSWORD_RESET_REQUIRED',
      'Password reset required',
      'This account needs a password reset before password sign-in can continue.',
      'Request a new reset link and finish the recovery flow in this app.',
    );
  }

  if (
    message.includes('database error querying schema') ||
    message.includes('database error checking user') ||
    (message.includes('schema') && message.includes('error')) ||
    status === 404 ||
    message.includes('user not found') ||
    code.includes('user_not_found')
  ) {
    return createAuthUiError(
      'USER_NOT_FOUND_OR_WRONG_PROJECT',
      'Could not find this account',
      'Supabase returned a backend lookup error while checking this account. The email may belong to a different Supabase project, or the auth record may be inconsistent in the current backend.',
      'Verify the app is pointed at the same Supabase project where the account was created, or inspect the auth record in Supabase.',
    );
  }

  if (
    message.includes('invalid login credentials') ||
    message.includes('email not found') ||
    message.includes('invalid credentials')
  ) {
    return createAuthUiError(
      'INVALID_PASSWORD_OR_NO_PASSWORD_ACCOUNT',
      'Could not sign in',
      'This email could belong to a LinkedIn-only account, a different Supabase project, or the password is incorrect.',
      'Try LinkedIn, request a password reset, or verify this app is using the same backend where the account was created.',
    );
  }

  if (status === 404 || message.includes('not found')) {
    return createAuthUiError(
      'USER_NOT_FOUND_OR_WRONG_PROJECT',
      'Could not find this account',
      'This email may belong to a different Supabase project, or the current auth backend does not have this user.',
      'Verify the app is pointed at the same Supabase project where the account was created.',
    );
  }

  return createAuthUiError(
    'UNKNOWN_AUTH_ERROR',
    'Authentication failed',
    authError.message || 'Supabase returned an unknown authentication error.',
    'Try again, or check the Supabase auth settings and backend project reference.',
    true,
  );
}
