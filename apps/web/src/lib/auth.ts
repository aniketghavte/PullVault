import 'server-only';
import { createSupabaseServerClient } from './supabase/server';
import { ApiError } from './api';
import { ERROR_CODES } from '@pullvault/shared';

// Returns the authenticated user id, or throws UNAUTHENTICATED.
export async function requireUserId(): Promise<string> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) {
    throw new ApiError(ERROR_CODES.UNAUTHENTICATED, 'Sign in to continue.');
  }
  return data.user.id;
}

// Returns the authenticated user object, or throws UNAUTHENTICATED.
export async function requireUser() {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) {
    throw new ApiError(ERROR_CODES.UNAUTHENTICATED, 'Sign in to continue.');
  }
  return data.user;
}
