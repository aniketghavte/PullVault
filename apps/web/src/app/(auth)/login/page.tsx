import { LoginForm } from './LoginForm';

function one(param: Record<string, string | string[] | undefined>, key: string): string | undefined {
  const v = param[key];
  if (typeof v === 'string') return v;
  return undefined;
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

export default function LoginPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const next = one(searchParams, 'next');
  const oauthError = one(searchParams, 'error');
  const oauthDetailRaw = one(searchParams, 'detail');

  return (
    <LoginForm
      defaultNext={next}
      oauthError={oauthError ?? null}
      oauthDetail={oauthDetailRaw ? safeDecode(oauthDetailRaw) : null}
    />
  );
}
