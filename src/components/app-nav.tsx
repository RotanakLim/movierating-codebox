"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Bell,
  Bookmark,
  Clapperboard,
  Compass,
  Film,
  House,
  Menu,
  Settings,
  UserRound,
  X,
  type LucideIcon,
} from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";
import { useProfile } from "@/components/profile-link";

type Item = {
  href: string;
  label: string;
  Icon: LucideIcon;
  match?: string;
  /** A count badge, e.g. pending follow requests. */
  count?: number;
};

/**
 * Left navigation on large screens; a top bar with an accessible menu on phones
 * and tablets. Nothing here scrolls horizontally at 360px.
 */
export function AppNav() {
  const pathname = usePathname();
  const profile = useProfile();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [pathname]);

  const items: Item[] = [
    { href: "/", label: "Home", Icon: House },
    { href: "/discover", label: "Discover", Icon: Compass, match: "/discover" },
    { href: "/me/movies", label: "My Movies", Icon: Film, match: "/me/movies" },
    {
      href: "/me/watchlist",
      label: "Watchlist",
      Icon: Bookmark,
      match: "/me/watchlist",
    },
    {
      href: "/notifications",
      label: "Notifications",
      Icon: Bell,
      match: "/notifications",
      count: profile?.requests,
    },
    profile?.username
      ? {
          href: `/u/${profile.username}`,
          label: "Profile",
          Icon: UserRound,
          match: `/u/${profile.username}`,
        }
      : profile
        ? { href: "/onboarding", label: "Finish setup", Icon: UserRound }
        : { href: "/auth/sign-in", label: "Sign in", Icon: UserRound },
    {
      href: "/settings",
      label: "Settings",
      Icon: Settings,
      match: "/settings",
    },
  ];
  const isActive = (item: Item) =>
    item.match
      ? pathname === item.match || pathname.startsWith(`${item.match}/`)
      : pathname === item.href;

  const links = (
    <ul className="space-y-1">
      {items.map((item) => {
        const active = isActive(item);
        return (
          <li key={item.label}>
            <Link
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm ${
                active
                  ? "bg-accent/10 font-semibold text-ink"
                  : "text-muted hover:bg-line/40 hover:text-ink"
              }`}
            >
              <item.Icon size={18} aria-hidden="true" />
              {item.label}
              {item.count ? (
                <span className="ml-auto rounded-full bg-accent px-2 py-0.5 text-xs font-semibold text-canvas">
                  {item.count > 99 ? "99+" : item.count}
                  <span className="sr-only">
                    {" "}
                    pending follow request{item.count === 1 ? "" : "s"}
                  </span>
                </span>
              ) : null}
            </Link>
          </li>
        );
      })}
    </ul>
  );
  const brand = (
    <Link
      href="/"
      className="flex items-center gap-2.5 font-semibold tracking-tight"
    >
      <span className="rounded-lg bg-accent p-2 text-canvas">
        <Clapperboard size={20} aria-hidden="true" />
      </span>
      <span>
        CodeBox <span className="font-normal text-muted">Movies</span>
      </span>
    </Link>
  );

  return (
    <>
      {/* Phones and tablets: top bar with a menu button. */}
      <header className="border-b border-line lg:hidden">
        <div className="flex items-center justify-between gap-3 px-5 py-4 sm:px-10">
          {brand}
          <div className="flex items-center gap-2">
            <ThemeToggle signedIn={Boolean(profile?.username)} />
            <button
              type="button"
              className="rounded-lg p-2 text-muted hover:text-ink"
              aria-expanded={open}
              aria-controls="mobile-nav"
              aria-label={open ? "Close menu" : "Open menu"}
              onClick={() => setOpen(!open)}
            >
              {open ? (
                <X size={22} aria-hidden="true" />
              ) : (
                <Menu size={22} aria-hidden="true" />
              )}
            </button>
          </div>
        </div>
        {open && (
          <nav
            id="mobile-nav"
            aria-label="Main"
            className="border-t border-line px-5 py-3 sm:px-10"
          >
            {links}
          </nav>
        )}
      </header>

      {/* Large screens: sticky left navigation. */}
      <aside className="hidden lg:block">
        <div className="sticky top-0 flex h-screen flex-col gap-8 border-r border-line px-4 py-6">
          <div className="px-2">{brand}</div>
          <nav aria-label="Main" className="flex-1">
            {links}
          </nav>
          <div className="px-2">
            <ThemeToggle signedIn={Boolean(profile?.username)} />
          </div>
        </div>
      </aside>
    </>
  );
}
