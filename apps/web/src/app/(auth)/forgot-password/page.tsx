'use client';

import Link from 'next/link';
import { useState } from 'react';

import { ContactFormCard } from '@/components/ui/ContactFormCard';
import { ButtonPrimary } from '@/components/ui/ButtonPrimary';
import { clientEnv } from '@/lib/env';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [info, setInfo] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setInfo(null);
    const redirect = `${clientEnv.NEXT_PUBLIC_APP_URL}/auth/callback?next=/login`;
    const supabase = getSupabaseBrowserClient();
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: redirect,
    });
    setLoading(false);
    if (error) {
      setInfo(error.message);
      return;
    }
    setInfo(
      'If we find that address we will send a reset link shortly. Finish the reset from email, then sign in.',
    );
  }

  return (
    <section className="w-full px-4 py-16 bg-stone">
      <div className="mx-auto w-full max-w-lg">
        <div className="space-y-3 mb-8">
          <div className="text-monoLabel uppercase tracking-[0.28px] text-mutedSlate">
            Account recovery
          </div>
          <h1 className="font-display text-sectionDisplay tracking-tight leading-none">
            Reset password
          </h1>
          <p className="text-bodyLarge text-ink/70">
            Submit your email—we send a magic link handled by{' '}
            <code className="text-micro bg-stone px-1 rounded">/auth/callback</code> so your new session stays
            on the SSR cookie path.
          </p>
        </div>

        <ContactFormCard>
          <form onSubmit={handleSubmit} className="space-y-6">
            {info && (
              <div
                role="status"
                className={`rounded-sm border px-4 py-3 text-body text-ink ${
                  info.startsWith('If we find')
                    ? 'border-formFocusViolet/40 bg-white/70'
                    : 'border-coral/40 bg-coral/5'
                }`}
              >
                {info}
              </div>
            )}
            <div>
              <label htmlFor="reset-email" className="text-micro font-semibold text-mutedSlate">
                Email
              </label>
              <input
                id="reset-email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="mt-2 w-full rounded-sm border border-cardBorder bg-canvas px-4 py-3 text-body outline-none focus:border-formFocusViolet"
              />
            </div>
            <ButtonPrimary type="submit" className="w-full justify-center" disabled={loading}>
              {loading ? 'Sending…' : 'Send reset link'}
            </ButtonPrimary>

            <p className="text-body text-center text-ink/70">
              <Link
                href="/login"
                className="text-actionBlue underline underline-offset-4 decoration-actionBlue/30"
              >
                Back to sign in
              </Link>
            </p>
          </form>
        </ContactFormCard>
      </div>
    </section>
  );
}
