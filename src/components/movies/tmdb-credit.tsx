"use client";
import Image from "next/image";
import { useState } from "react";
export function TmdbCredit() {
  const [unavailable, setUnavailable] = useState(false);
  return (
    <a href="https://www.themoviedb.org" target="_blank" rel="noreferrer">
      {unavailable ? (
        <span className="font-semibold text-accent">TMDB</span>
      ) : (
        <Image
          unoptimized
          src="https://www.themoviedb.org/assets/2/v4/logos/v2/blue_short-8e7b30f73a4020692ccca9c88bafe5dcb6f8a62a4c6bc55cd9ba82bb2cd95f6c.svg"
          alt="TMDB"
          width={120}
          height={16}
          onError={() => setUnavailable(true)}
        />
      )}
    </a>
  );
}
