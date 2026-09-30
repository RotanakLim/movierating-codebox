import Image from "next/image";
import { UserRound } from "lucide-react";

/**
 * A user's avatar, or a placeholder icon. Avatars are already re-encoded to a
 * small WebP when uploaded, so Next.js image optimization is skipped.
 */
export function Avatar({
  src,
  size,
  className = "",
}: {
  src: string | null;
  size: number;
  className?: string;
}) {
  return (
    <span
      className={`relative flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-line/70 text-muted ${className}`}
      style={{ width: size, height: size }}
    >
      {src ? (
        <Image
          src={src}
          alt=""
          width={size}
          height={size}
          unoptimized
          className="h-full w-full object-cover"
        />
      ) : (
        <UserRound size={Math.round(size * 0.45)} aria-hidden="true" />
      )}
    </span>
  );
}
