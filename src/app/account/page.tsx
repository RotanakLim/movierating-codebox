import type { Metadata } from "next";
import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { requireUser } from "@/lib/auth/user";
import { SignOutButton } from "@/components/sign-out-button";
export const metadata: Metadata = {
  title: "Your account",
  robots: { index: false, follow: false },
};
export default async function AccountPage() {
  const user = await requireUser();
  return (
    <section className="mx-auto max-w-2xl py-16">
      <p className="eyebrow mb-4">YOUR CODEBOX ACCOUNT</p>
      <h1 className="font-display text-4xl">
        You’re in. Make yourself at home.
      </h1>
      <div className="mt-8 rounded-2xl border border-line bg-surface p-6">
        <div className="flex items-center gap-3">
          <ShieldCheck
            className="shrink-0 text-accent"
            size={24}
            aria-hidden="true"
          />
          <div className="min-w-0">
            <h2 className="font-semibold">Signed in securely</h2>
            <p className="break-all text-sm text-muted">{user.email}</p>
          </div>
        </div>
        <p className="mt-6 text-sm leading-relaxed text-muted">
          Your account is ready. Movie discovery, your diary, and personal
          profiles are the next part of CodeBox Movies.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link className="button-secondary" href="/auth/update-password">
            Set or change password
          </Link>
          <SignOutButton />
        </div>
      </div>
    </section>
  );
}
