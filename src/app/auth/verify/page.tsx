import { AuthScreen } from "@/components/auth-screen";
import { safeNext } from "@/lib/auth/redirect";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const params = await searchParams;
  return <AuthScreen mode="verify" next={safeNext(params.next)} />;
}
