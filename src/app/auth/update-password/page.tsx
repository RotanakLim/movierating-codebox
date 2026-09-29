import { AuthScreen } from "@/components/auth-screen";
import { safeNext } from "@/lib/auth/redirect";
import { requireUser } from "@/lib/auth/user";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  await requireUser("/auth/update-password");
  const params = await searchParams;
  return <AuthScreen mode="update-password" next={safeNext(params.next)} />;
}
