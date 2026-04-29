'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';

import { ContactFormCard } from '@/components/ui/ContactFormCard';
import { ButtonPrimary } from '@/components/ui/ButtonPrimary';
import { DarkFeatureBand } from '@/components/ui/DarkFeatureBand';
import { sanitizeReturnPath } from '@/lib/auth-redirect';
import { clientEnv } from '@/lib/env';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';

export function SignupForm(props: { defaultNext?: string }) {
  const router = useRouter();
  const redirectTo = useMemo(
    () => sanitizeReturnPath(props.defaultNext, '/drops'),
    [props.defaultNext],
  );
  const [handle, setHandle] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [successPendingConfirm, setSuccessPendingConfirm] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setMessage(null);
    setSuccessPendingConfirm(false);

    const trimmedHandle = handle.trim();
    const trimmedEmail = email.trim();

    if (trimmedHandle.length < 2) {
      setLoading(false);
      setMessage('Choose a handle at least two characters.');
      return;
    }
    if (password.length < 8) {
      setLoading(false);
      setMessage('Use at least 8 characters for your password.');
      return;
    }

    const callback = new URL('/auth/callback', clientEnv.NEXT_PUBLIC_APP_URL);
    callback.searchParams.set('next', redirectTo);

    const supabase = getSupabaseBrowserClient();
    const { data, error } = await supabase.auth.signUp({
      email: trimmedEmail,
      password,
      options: {
        data: {
          handle: trimmedHandle,
        },
        emailRedirectTo: callback.toString(),
      },
    });

    setLoading(false);
    if (error) {
      if (error.message.includes('already registered')) {
        setMessage('That email already has an account. Sign in instead.');
      } else {
        setMessage(error.message ?? 'Signup failed.');
      }
      return;
    }

    // Session may be null when "Confirm email" is enabled on the Supabase project.
    if (data.session) {
      router.refresh();
      router.replace(redirectTo);
      return;
    }

    setSuccessPendingConfirm(true);
  }

  return (
    <section className="w-full px-4 py-16 bg-stone">
      <div className="mx-auto w-full max-w-5xl">
        <div className="grid gap-10 lg:grid-cols-2 items-start">
          <div className="space-y-4">
            <div className="text-monoLabel uppercase tracking-[0.28px] text-mutedSlate">
              Create account
            </div>
            <h1 className="font-display text-sectionDisplay tracking-tight leading-none">
              Join PullVault
            </h1>
            <p className="text-bodyLarge text-ink/70">
              Signing up provisions a Postgres profile keyed to Supabase{' '}
              <code className="text-micro bg-stone px-1.5 py-0.5 rounded">auth.users.id</code>, including your
              paper balance and holdings.
            </p>

            <DarkFeatureBand tone="green" className="py-10 px-6 rounded-lg border border-cardBorder">
              <div className="space-y-2">
                <div className="text-featureHeading font-semibold">Balances & holdings</div>
                <p className="text-bodyLarge text-canvas/85">
                  Fees and valuations follow PullVault ledger rules—all writes require your authenticated{' '}
                  <code className="text-micro">userId</code>.
                </p>
              </div>
            </DarkFeatureBand>
          </div>

          <ContactFormCard>
            <form onSubmit={handleSubmit} className="space-y-6">
              {(message ?? successPendingConfirm) && (
                <div
                  role={successPendingConfirm ? 'status' : 'alert'}
                  className={`rounded-sm border px-4 py-3 text-body ${
                    successPendingConfirm
                      ? 'border-formFocusViolet/40 bg-white/70 text-ink'
                      : 'border-coral/40 bg-coral/5 text-ink'
                  }`}
                >
                  {successPendingConfirm ? (
                    <>
                      Almost done—we sent a confirmation link to <strong>{email.trim()}</strong>. Follow it,
                      then return here and sign in. If you disabled email confirmation in Supabase you will be
                      redirected automatically instead.
                    </>
                  ) : (
                    message
                  )}
                </div>
              )}

              <div>
                <label htmlFor="signup-handle" className="text-micro font-semibold text-mutedSlate">
                  Display handle
                </label>
                <input
                  id="signup-handle"
                  name="handle"
                  type="text"
                  autoComplete="username"
                  required
                  maxLength={32}
                  value={handle}
                  onChange={(e) => setHandle(e.target.value)}
                  placeholder="trainer_maya"
                  className="mt-2 w-full rounded-sm border border-cardBorder bg-canvas px-4 py-3 text-body outline-none focus:outline-none focus:border-formFocusViolet"
                />
                <p className="mt-1 text-micro text-mutedSlate">
                  Unique identifier on the vault; stored as your profile handle.
                </p>
              </div>
              <div>
                <label htmlFor="signup-email" className="text-micro font-semibold text-mutedSlate">
                  Email
                </label>
                <input
                  id="signup-email"
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
                <label htmlFor="signup-password" className="text-micro font-semibold text-mutedSlate">
                  Password
                </label>
                <input
                  id="signup-password"
                  name="password"
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={8}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="mt-2 w-full rounded-sm border border-cardBorder bg-canvas px-4 py-3 text-body outline-none focus:outline-none focus:border-formFocusViolet"
                />
              </div>

              <div className="pt-2">
                <ButtonPrimary type="submit" className="w-full justify-center" disabled={loading}>
                  {loading ? 'Creating…' : 'Create account'}
                </ButtonPrimary>
              </div>

              <div className="text-body text-ink/70">
                Already have an account?{' '}
                <Link
                  href={`/login?next=${encodeURIComponent(redirectTo)}`}
                  className="text-actionBlue underline underline-offset-4 decoration-actionBlue/30 hover:decoration-actionBlue/60"
                >
                  Sign in
                </Link>
              </div>
            </form>
          </ContactFormCard>
        </div>
      </div>
    </section>
  );
}
