import { createHmac } from 'node:crypto';

/**
 * [ACC-02] Demo sign-ins on previews (01 §9.5, D-39). supabase/seed.sql creates them without a
 * password; scripts/preview-db.sh sets each one to the HMAC below, keyed with the deployment
 * protection bypass secret, which Vercel gives every deployment. A preview derives the same
 * password to sign in with one tap, so nobody stores or types it, and previews still hold no key
 * that bypasses RLS: a demo admin sees only the demo family.
 */
export const DEMO_PERSONAS = [
  { key: 'alex', name: 'Alex', about: 'Owner of the demo family' },
  { key: 'sam', name: 'Sam', about: 'Admin of the demo family' },
  { key: 'jordan', name: 'Jordan', about: 'A parent with an invite to accept' },
  { key: 'riley', name: 'Riley', about: 'A parent setting up a new household' },
] as const;

export type DemoPersona = (typeof DEMO_PERSONAS)[number]['key'];

export function demoEmail(persona: DemoPersona): string {
  return `${persona}@demo.familywise.invalid`;
}

export function isDemoPersona(value: unknown): value is DemoPersona {
  return DEMO_PERSONAS.some((p) => p.key === value);
}

/** The password scripts/preview-db.sh gave this demo sign-in (the same vector is tested there). */
export function demoPassword(secret: string, email: string): string {
  return createHmac('sha256', secret).update(`familywise demo sign-in ${email}`).digest('hex');
}

/** The bypass secret, on a preview only; null everywhere else, which turns demo sign-in off. */
export function demoSecret(env: Record<string, string | undefined> = process.env): string | null {
  return env.VERCEL_ENV === 'preview' && env.VERCEL_AUTOMATION_BYPASS_SECRET
    ? env.VERCEL_AUTOMATION_BYPASS_SECRET
    : null;
}
