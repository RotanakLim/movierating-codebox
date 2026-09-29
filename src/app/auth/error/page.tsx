import Link from "next/link";
export default function AuthError() {
  return (
    <section className="mx-auto max-w-md py-16">
      <p className="eyebrow mb-4">LET’S TRY THAT AGAIN</p>
      <h1 className="font-display text-4xl">We couldn’t finish that.</h1>
      <p className="mt-4 leading-relaxed text-muted">
        Your link may have expired or already been used, or sign-in was
        canceled. If you were signing out, try again from your account.
      </p>
      <div className="mt-8 flex flex-col gap-3">
        <Link className="button-primary" href="/auth/sign-in">
          Back to sign in
        </Link>
        <Link className="button-secondary" href="/auth/verify">
          Resend confirmation email
        </Link>
        <Link className="button-secondary" href="/auth/forgot-password">
          Request a password reset
        </Link>
        <Link className="text-center text-sm text-accent" href="/account">
          Your account
        </Link>
      </div>
    </section>
  );
}
