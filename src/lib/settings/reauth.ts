/**
 * How someone proves it's them before deleting their account, from the sign-in
 * methods their account has (Supabase identities) and whether Google sign-in is
 * switched on for this site (GOOGLE_AUTH_ENABLED).
 *
 * - Google is offered only while it's switched on; otherwise it would always fail.
 * - The password check is offered whenever Google isn't, so nobody is left with
 *   no way to confirm.
 * - An account that only has Google, while Google is off, may not have a password
 *   yet: `setPasswordFirst` tells Settings to link to setting one.
 */
export function reauthOptions(providers: Set<string>, googleEnabled: boolean) {
  const hasGoogle = googleEnabled && providers.has("google");
  return {
    hasGoogle,
    hasPassword: providers.has("email") || !hasGoogle,
    setPasswordFirst:
      !googleEnabled && providers.has("google") && !providers.has("email"),
  };
}
