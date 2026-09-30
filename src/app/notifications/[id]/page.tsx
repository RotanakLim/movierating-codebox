import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { requireOnboardedUser } from "@/lib/profiles/load";
import { openNotification } from "@/lib/notifications/load";
import { UNAVAILABLE } from "@/lib/notifications/types";

export const metadata: Metadata = {
  title: "Notification",
  robots: { index: false, follow: false },
};

/**
 * Opening a notification marks it read and re-checks access in the database at
 * that moment; a target that was deleted, hidden or blocked since is never shown.
 */
export default async function OpenNotification({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) notFound();
  const { supabase } = await requireOnboardedUser(`/notifications/${id.data}`);
  const target = await openNotification(supabase, id.data);
  if (target === undefined) notFound();
  if (target) redirect(target);
  return (
    <section className="mx-auto max-w-2xl py-16">
      <h1 className="font-display text-3xl">{UNAVAILABLE}</h1>
      <p className="mt-4 text-muted">
        It may have been deleted, hidden, or made private since you were
        notified.
      </p>
      <Link href="/notifications" className="button-secondary mt-8">
        Back to notifications
      </Link>
    </section>
  );
}
