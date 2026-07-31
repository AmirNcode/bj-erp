/**
 * Maps an employee code to a synthetic internal auth email.
 * Supabase Auth is keyed on email; this mapping lets users log in
 * with just a code + password and never see an email address.
 */

/**
 * Converts an employee code to the synthetic email used in Supabase Auth.
 * Convention: `code.trim().toLowerCase() + '@bj-app.internal'`
 *
 * @example codeToAuthEmail('A-100') => 'a-100@bj-app.internal'
 */
export function codeToAuthEmail(code: string): string {
  return code.trim().toLowerCase() + '@bj-app.internal';
}

/**
 * Sign in using an employee code + password.
 * Translates the code to a synthetic email before calling Supabase Auth.
 * Import is deferred inside the function so this module can be imported
 * in unit tests without requiring NEXT_PUBLIC_SUPABASE_* env vars.
 */
export async function signInWithCode(code: string, password: string) {
  const { createClient } = await import('@/lib/supabase/client');
  const supabase = createClient();
  const result = await supabase.auth.signInWithPassword({
    email: codeToAuthEmail(code),
    password,
  });

  if (result.error || !result.data.user) {
    return { ...result, inactive: false };
  }

  // Auth and the HR profile are separate records.  A deactivated profile can
  // still have a valid Auth password, so fail closed here and clear the newly
  // issued session.  RLS independently enforces the same boundary.
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('active')
    .eq('id', result.data.user.id)
    .single();
  if (profileError || !profile?.active) {
    await supabase.auth.signOut();
    return { ...result, inactive: true };
  }

  return { ...result, inactive: false };
}
