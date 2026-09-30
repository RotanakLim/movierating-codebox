import { getPublicConfig } from "@/lib/env";

/**
 * Public URL for a stored avatar path (`<user id>/<file>.webp`). Every upload
 * gets a new file name, so the URL changes whenever the picture does.
 */
export function avatarUrl(path: string | null | undefined): string | null {
  const config = getPublicConfig();
  if (!path || !config) return null;
  return `${config.url}/storage/v1/object/public/avatars/${path
    .split("/")
    .map(encodeURIComponent)
    .join("/")}`;
}
