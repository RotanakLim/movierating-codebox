export function getPublicConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();
  const site = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (!url || !key || !site || key.startsWith("sb_secret_")) return null;
  try {
    const supabase = new URL(url);
    const origin = new URL(site);
    const valid = (value: URL) =>
      value.protocol === "https:" ||
      (value.protocol === "http:" &&
        ["localhost", "127.0.0.1"].includes(value.hostname));
    if (
      !valid(supabase) ||
      !valid(origin) ||
      supabase.username ||
      supabase.password ||
      origin.username ||
      origin.password ||
      origin.pathname !== "/" ||
      origin.search ||
      origin.hash
    )
      return null;
    return { url: supabase.origin, key, siteUrl: origin.origin };
  } catch {
    return null;
  }
}

export function requirePublicConfig() {
  const config = getPublicConfig();
  if (!config)
    throw new Error(
      "Configure the public Supabase URL, publishable key, and site URL in .env.local.",
    );
  return config;
}
