import type { Metadata } from "next";
import Link from "next/link";
import { AppNav } from "@/components/app-nav";
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
        <div className="lg:grid lg:grid-cols-[232px_minmax(0,1fr)]">
          <AppNav />
          <div className="min-w-0">
            <main id="main" className="mx-auto max-w-7xl px-5 sm:px-10">
              {children}
            </main>
            <footer className="mx-auto mt-12 flex max-w-7xl flex-wrap items-center justify-between gap-4 border-t border-line px-5 py-6 text-xs text-muted sm:px-10">
              <p>A little space for your love of movies.</p>
              <div className="flex gap-4">
                <Link href="/account" className="hover:text-ink">
                  Account
                </Link>
                <Link href="/about" className="hover:text-ink">
                  About &amp; credits
                </Link>
              </div>
            </footer>
          </div>
        </div>
      </body>
    </html>
  );
}
