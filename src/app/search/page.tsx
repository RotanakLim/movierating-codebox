import { redirect } from "next/navigation";
export default async function SearchAlias({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const values = await searchParams;
  const params = new URLSearchParams();
  for (const key of ["q", "genre", "year"])
    if (typeof values[key] === "string") params.set(key, values[key]);
  redirect(`/discover${params.size ? `?${params}` : ""}`);
}
