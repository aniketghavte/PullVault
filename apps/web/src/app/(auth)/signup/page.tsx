'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { ContactFormCard } from '@/components/ui/ContactFormCard';
import { ButtonPrimary } from '@/components/ui/ButtonPrimary';
import { DarkFeatureBand } from '@/components/ui/DarkFeatureBand';

export default function SignupPage() {
  const router = useRouter();

  return (
    <section className="w-full px-4 py-16 bg-stone">
      <div className="mx-auto w-full max-w-5xl">
        <div className="grid gap-10 lg:grid-cols-2 items-start">
          <div className="space-y-4">
            <div className="text-monoLabel uppercase tracking-[0.28px] text-mutedSlate">
              Auth (mocked)
            </div>
            <h1 className="font-display text-sectionDisplay tracking-tight leading-none">
              Create account
            </h1>
            <p className="text-bodyLarge text-ink/70">
              No real authentication is performed. This screen exists so the next iteration can
              plug into Supabase without redoing the UI shell.
            </p>

            <DarkFeatureBand tone="green" className="py-10 px-6 rounded-lg border border-cardBorder">
              <div className="space-y-2">
                <div className="text-featureHeading font-semibold">Paper trading economy</div>
                <p className="text-bodyLarge text-canvas/85">Every balance and fee is simulated.</p>
              </div>
            </DarkFeatureBand>
          </div>

          <ContactFormCard>
            <div className="space-y-6">
              <div>
                <div className="text-micro font-semibold text-mutedSlate">Display name</div>
                <input
                  type="text"
                  placeholder="You"
                  className="mt-2 w-full rounded-sm border border-cardBorder bg-canvas px-4 py-3 text-body outline-none focus:outline-none focus:border-formFocusViolet"
                />
              </div>
              <div>
                <div className="text-micro font-semibold text-mutedSlate">Email</div>
                <input
                  type="email"
                  placeholder="you@example.com"
                  className="mt-2 w-full rounded-sm border border-cardBorder bg-canvas px-4 py-3 text-body outline-none focus:outline-none focus:border-formFocusViolet"
                />
              </div>
              <div>
                <div className="text-micro font-semibold text-mutedSlate">Password</div>
                <input
                  type="password"
                  placeholder="••••••••"
                  className="mt-2 w-full rounded-sm border border-cardBorder bg-canvas px-4 py-3 text-body outline-none focus:outline-none focus:border-formFocusViolet"
                />
              </div>

              <div className="pt-2 flex items-center justify-between gap-4">
                <ButtonPrimary onClick={() => router.push('/drops')} className="w-full justify-center">
                  Create account
                </ButtonPrimary>
              </div>

              <div className="text-body text-ink/70">
                Already have an account?{' '}
                <Link
                  href="/login"
                  className="text-actionBlue underline underline-offset-4 decoration-actionBlue/30 hover:decoration-actionBlue/60"
                >
                  Sign in
                </Link>
              </div>

              <div className="text-micro text-ink/60">Tip: no backend calls in this mock build.</div>
            </div>
          </ContactFormCard>
        </div>
      </div>
    </section>
  );
}
