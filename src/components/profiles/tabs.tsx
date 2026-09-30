"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

/** Movies / Diary / Watchlist / Lists tabs; the base path is /me or /u/<name>. */
export function ProfileTabs({ base }: { base: string }) {
  const pathname = usePathname();
  const tabs = [
    { href: base === "/me" ? "/me/movies" : base, label: "Movies" },
    { href: `${base}/diary`, label: "Diary" },
    { href: `${base}/watchlist`, label: "Watchlist" },
    { href: `${base}/lists`, label: "Lists" },
  ];
  return (
    <nav aria-label="Profile sections" className="border-b border-line">
      <ul className="-mb-px flex gap-6 overflow-x-auto text-sm">
        {tabs.map((tab) => {
          const active =
            pathname === tab.href ||
            (tab.label === "Lists" && pathname.startsWith(`${tab.href}/`));
          return (
            <li key={tab.href}>
              <Link
                href={tab.href}
                aria-current={active ? "page" : undefined}
                className={`inline-block border-b-2 py-3 ${
                  active
                    ? "border-accent font-semibold text-ink"
                    : "border-transparent text-muted hover:text-ink"
                }`}
              >
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
