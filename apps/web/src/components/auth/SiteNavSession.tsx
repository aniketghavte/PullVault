'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { ButtonPrimary } from '@/components/ui/ButtonPrimary';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';

type Props = {
  /** From server `supabase.auth.getUser()` — never trust client-supplied identities for authz. */
  sessionEmail: string | null;
};

export function SiteNavSession({ sessionEmail }: Props) {
  const router = useRouter();

  async function handleSignOut() {
    const supabase = getSupabaseBrowserClient();
    await supabase.auth.signOut();
    router.refresh();
    router.push('/');
  }

  if (!sessionEmail) {
    return (
      <div className="flex items-center gap-3">
        <Link
          href="/login"
          className="text-micro text-nearBlack/80 hover:text-nearBlack underline decoration-nearBlack/20 underline-offset-4"
        >
          Sign in
        </Link>
        <Link
          href="/signup"
          className="text-micro text-nearBlack/70 hover:text-nearBlack hidden sm:inline underline decoration-nearBlack/15 underline-offset-4"
        >
          Sign up
        </Link>
        <ButtonPrimary href="/drops">Start trading</ButtonPrimary>
      </div>
    );
  }

  const shortLabel = sessionEmail.includes('@')
    ? sessionEmail.split('@')[0]!.slice(0, 24)
    : sessionEmail.slice(0, 24);

  return (
    <div className="flex items-center gap-3">
      <span
        title={sessionEmail ?? undefined}
        className="text-micro text-nearBlack/80 max-w-[140px] truncate md:max-w-[200px]"
      >
        {shortLabel}
      </span>
      <button
        type="button"
        onClick={() => void handleSignOut()}
        className="text-micro text-nearBlack/80 hover:text-nearBlack underline decoration-nearBlack/20 underline-offset-4"
      >
        Sign out
      </button>
      <ButtonPrimary href="/drops">Trading</ButtonPrimary>
    </div>
  );
}
