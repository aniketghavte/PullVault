'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';

import { ContactFormCard } from '@/components/ui/ContactFormCard';
import { ButtonPrimary } from '@/components/ui/ButtonPrimary';
import { DarkFeatureBand } from '@/components/ui/DarkFeatureBand';
import { sanitizeReturnPath } from '@/lib/auth-redirect';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';

function loginErrorCopy(code?: string): string | null {
  if (!code) return null;
  const map: Record<string, string> = {
    missing_code:
      'Authorization could not finish. Request a fresh sign-in link or try signing in again.',
    oauth: 'Sign-in redirect did not finish. Close this tab and try again.',
    oauth_config: 'OAuth is not configured. Use email and password.',
    exchange: 'Session exchange failed. Try signing in again.',
    config: 'Server configuration is incomplete. Ask an operator to verify Supabase env vars.',
    invalid_credentials: 'Invalid email or password.',
    too_many_attempts: 'Too many attempts. Wait briefly and retry.',
    email_not_confirmed: 'Confirm your email before signing in, or check your inbox for the link.',
  };
  return map[code] ?? `Something went wrong (${code}). Try again or contact support.`;
}

export function LoginForm(props: {
  defaultNext?: string;
  oauthError?: string | null;
  oauthDetail?: string | null;
}) {
  const router = useRouter();
  const redirectTo = useMemo(
    () => sanitizeReturnPath(props.defaultNext, '/drops'),
    [props.defaultNext],
  );
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const oauthMessage = loginErrorCopy(props.oauthError ?? undefined) ?? props.oauthDetail;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setMessage(null);
    const supabase = getSupabaseBrowserClient();
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setLoading(false);
    if (error) {
      if (error.message.toLowerCase().includes('email not confirmed')) {
        setMessage(loginErrorCopy('email_not_confirmed'));
      } else if (/invalid login credentials/i.test(error.message)) {
        setMessage(loginErrorCopy('invalid_credentials'));
      } else {
        setMessage(error.message || 'Could not sign in.');
      }
      return;
    }
    router.refresh();
    router.replace(redirectTo);
  }

  return (
    <section className="w-full px-4 py-16 bg-stone">
      <div className="mx-auto w-full max-w-5xl">
        <div className="grid gap-10 lg:grid-cols-2 items-start">
          <div className="space-y-4">
            <div className="text-monoLabel uppercase tracking-[0.28px] text-mutedSlate">
              Sign in
            </div>
            <h1 className="font-display text-sectionDisplay tracking-tight leading-none">
              Welcome back
            </h1>
            <p className="text-bodyLarge text-ink/70">
              PullVault uses Supabase Auth. Your balance and pulls are tied to this account—the same{' '}
              <code className="text-micro bg-stone px-1.5 py-0.5 rounded">userId</code> backs every trade
              and auction.
            </p>
            <DarkFeatureBand tone="navy" className="py-10 px-6 rounded-lg border border-cardBorder">
              <div className="space-y-2">
                <div className="text-featureHeading font-semibold">Realtime & API access</div>
                <p className="text-bodyLarge text-canvas/85">
                  After signing in, API routes resolve your wallet from Postgres; the drops service can
                  pass your bearer token when connecting to websockets for live auctions.
                </p>
              </div>
            </DarkFeatureBand>
          </div>

          <ContactFormCard>
            <form onSubmit={handleSubmit} className="space-y-6">
              {(oauthMessage || message) && (
                <div
                  role="alert"
                  className="rounded-sm border border-coral/40 bg-coral/5 px-4 py-3 text-body text-ink"
                >
                  {message ?? oauthMessage}
                </div>
              )}
              <div>
                <label htmlFor="login-email" className="text-micro font-semibold text-mutedSlate">
                  Email
                </label>
                <input
                  id="login-email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="mt-2 w-full rounded-sm border border-cardBorder bg-canvas px-4 py-3 text-body outline-none focus:outline-none focus:border-formFocusViolet"
                />
              </div>
              <div>
                <div className="flex items-center justify-between gap-3">
                  <label htmlFor="login-password" className="text-micro font-semibold text-mutedSlate">
                    Password
                  </label>
                  <Link
                    href="/forgot-password"
                    className="text-micro text-actionBlue underline underline-offset-4 decoration-actionBlue/30 hover:decoration-actionBlue/60"
                  >
                    Forgot password?
                  </Link>
                </div>
                <input
                  id="login-password"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="mt-2 w-full rounded-sm border border-cardBorder bg-canvas px-4 py-3 text-body outline-none focus:outline-none focus:border-formFocusViolet"
                />
              </div>

              <input type="hidden" name="next" value={redirectTo} />

              <div className="pt-2">
                <ButtonPrimary type="submit" className="w-full justify-center" disabled={loading}>
                  {loading ? 'Signing in…' : 'Sign in'}
                </ButtonPrimary>
              </div>

              <div className="text-body text-ink/70">
                New here?{' '}
                <Link
                  href={`/signup?next=${encodeURIComponent(redirectTo)}`}
                  className="text-actionBlue underline underline-offset-4 decoration-actionBlue/30 hover:decoration-actionBlue/60"
                >
                  Create an account
                </Link>
              </div>
            </form>
          </ContactFormCard>
        </div>
      </div>
    </section>
  );
}
