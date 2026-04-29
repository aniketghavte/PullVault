import { SignupForm } from './SignupForm';

export default function SignupPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const next =
    typeof searchParams.next === 'string' ? searchParams.next : undefined;
  return <SignupForm defaultNext={next} />;
}
