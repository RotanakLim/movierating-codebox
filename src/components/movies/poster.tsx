"use client";
import Image from "next/image";
import { Film } from "lucide-react";
import { useState } from "react";
// TMDB already serves resized, CDN-cached posters. Request the size we display
// and skip Next.js image optimization, which would re-fetch and re-encode each one.
export type PosterSize = "w342" | "w500";
export function MoviePoster({
  path,
  title,
  size,
  priority = false,
}: {
  path: string | null;
  title: string;
  size: PosterSize;
  priority?: boolean;
}) {
  const [failedPath, setFailedPath] = useState<string | null>(null);
  return (
    <div className="relative aspect-[2/3] overflow-hidden rounded-xl bg-line/60">
      {path && failedPath !== path ? (
        <Image
          src={`https://image.tmdb.org/t/p/${size}${path}`}
          alt={`${title} poster`}
          fill
          unoptimized
          priority={priority}
          className="object-cover transition-transform duration-300 group-hover:scale-[1.025]"
          onError={() => setFailedPath(path)}
        />
      ) : (
        <div className="flex h-full flex-col items-center justify-center gap-3 p-4 text-center text-muted">
          <Film size={32} strokeWidth={1} aria-hidden="true" />
          <span className="text-xs">Poster unavailable</span>
        </div>
      )}
    </div>
  );
}
