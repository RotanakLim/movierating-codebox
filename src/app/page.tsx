import { getUser } from "@/lib/auth/user";
import { createClient } from "@/lib/supabase/server";
import { readUsername } from "@/lib/onboarding/profile";
import { Landing } from "@/components/home/landing";
import { FeedHome } from "@/components/home/feed-home";
import { feedTab } from "@/lib/feed/types";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const user = await getUser();
  if (!user) return <Landing user={null} />;
  const supabase = await createClient();
  const username = await readUsername(supabase, user.id);
  // The feed needs a username (contributors only); onboarding comes first.
  if (!username) return <Landing user={user} />;
  const requested = feedTab((await searchParams).tab);
  return (
    <FeedHome
      supabase={supabase}
      userId={user.id}
      username={username}
      requested={requested}
    />
  );
}
