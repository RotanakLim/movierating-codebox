import type { Metadata } from "next";
import Link from "next/link";
import { Clapperboard } from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "CodeBox Movies — Keep the movies that stay with you",
    template: "%s | CodeBox Movies",
  },
  description:
    "A home for your movie memories, personal ratings, and shared discoveries.",
};
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('codebox-theme');document.documentElement.classList.toggle('dark',t==='dark'||(!t&&matchMedia('(prefers-color-scheme: dark)').matches))}catch(e){}})()`,
          }}
        />
      </head>
      <body className="min-h-screen antialiased">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:bg-surface focus:p-3"
        >
          Skip to content
        </a>
        <header className="border-b border-line">
          <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-5 py-5 sm:px-10">
            <Link
              href="/"
              className="flex items-center gap-2.5 font-semibold tracking-tight"
            >
              <span className="rounded-lg bg-accent p-2 text-canvas">
                <Clapperboard size={20} aria-hidden="true" />
              </span>
              <span>
                CodeBox{" "}
                <span className="hidden font-normal text-muted sm:inline">
                  Movies
                </span>
              </span>
            </Link>
            <div className="flex items-center gap-3 sm:gap-4">
              <Link
                href="/discover"
                className="text-sm text-muted hover:text-ink"
              >
                Discover
              </Link>
              <Link
                href="/account"
                className="text-sm text-muted hover:text-ink"
              >
                Account
              </Link>
              <ThemeToggle />
            </div>
          </div>
        </header>
        <main id="main" className="mx-auto max-w-7xl px-5 sm:px-10">
          {children}
        </main>
        <footer className="mx-auto mt-12 flex max-w-7xl flex-wrap items-center justify-between gap-4 border-t border-line px-5 py-6 text-xs text-muted sm:px-10">
          <p>A little space for your love of movies.</p>
          <Link href="/about" className="hover:text-ink">
            About &amp; credits
          </Link>
        </footer>
      </body>
    </html>
  );
}
