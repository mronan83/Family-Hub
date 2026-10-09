/**
 * [ACC-02][ACC-03] What an admin reads when sign-in, setup or an invite does not go through (06 §2:
 * clear, brief, neutral; what happened and the next step). Database functions raise a stable code
 * in HINT (supabase/migrations/20261009020000_admin_auth.sql); anything unknown gets a generic line,
 * and the detail goes to the log, never to the page.
 */
const HINTS: Record<string, string> = {
  not_signed_in: 'Sign in first, then try again.',
  setup_code_invalid:
    "That setup code isn't valid. Each code works once, for 24 hours. Ask for a new one if needed.",
  household_exists: 'You already run a household. Open it from the admin home.',
  not_admin: 'Only an admin of this household can do that.',
  bad_email: 'Enter an email address like name@example.com.',
  admin_exists: "They're already an admin of this household.",
  invite_unknown: "That invite link isn't valid. Ask for a new one.",
  invite_used: 'That invite was already used. Sign in instead, or ask for a new one.',
  invite_revoked: 'That invite was replaced or cancelled. Ask for a new one.',
  invite_expired: 'That invite has expired. Invites last 7 days. Ask for a new one.',
  invite_other_email:
    'This invite is for a different email address. Sign in with the one it was sent to, or ask for a new invite.',
  other_household: 'You already run another household, so you can’t join this one.',
  timezone: 'Choose a timezone from the list.',
};

export const GENERIC = 'That didn’t go through. Try again in a moment.';

/** What a form action hands back to its page: a line to show, and whether a link went out. */
export interface FormState {
  message?: string;
  sent?: boolean;
}

/** CI builds and local runs without the project settings. */
export const SIGN_IN_OFF = 'Sign-in isn’t set up on this deployment.';

/** The admin-facing line for a database error, by its HINT code. */
export function hintMessage(error: { hint?: string | null; code?: string | null } | null): string {
  if (!error) return GENERIC;
  if (error.code === '22023' && !error.hint) return HINTS.timezone ?? GENERIC;
  return (error.hint && HINTS[error.hint]) || GENERIC;
}

/** Sign-in by password: one line whatever the cause, so the page never says whether an account exists. */
export const SIGN_IN_FAILED =
  'That email and password don’t match an account. Check both and try again.';

/** Magic link and reset: the same line whether or not the account exists. */
export const LINK_SENT =
  'If that email has a FamilyWise account, a link is on its way. It works once, for 1 hour.';

/** Account creation (setup code or invite, production only). */
export function accountMessage(error: { code?: string | null } | null): string {
  switch (error?.code) {
    case 'email_exists':
    case 'user_already_exists':
      return 'That email already has an account. Sign in with it instead.';
    case 'weak_password':
      return PASSWORD_RULE;
    case 'email_address_invalid':
      return HINTS.bad_email ?? GENERIC;
    default:
      return GENERIC;
  }
}

export const MIN_PASSWORD = 8;
export const PASSWORD_RULE = `Use at least ${MIN_PASSWORD} characters for your password.`;
