/**
 * Root layout: navigation rail + main content column.
 *
 * Fonts are declared here as CSS variables that `globals.css` consumes at
 * the head of its stacks, so a font that fails to load degrades to the
 * platform UI/monospace faces instead of breaking the theme.
 */
import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { Sidebar } from "@/components/sidebar";
import { Providers } from "@/components/providers";

const sans = Inter({
  subsets: ["latin"],
  variable: "--font-sans-stack",
  display: "swap",
});

const mono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono-stack",
  display: "swap",
});

export const metadata: Metadata = {
  title: "WatchingEye",
  description: "Deterministic edge vision platform — every decision explained.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`dark ${sans.variable} ${mono.variable}`}>
      <body className="antialiased">
        <Providers>
          <div className="flex min-h-screen">
            <Sidebar />
            <main className="flex-1 overflow-x-hidden px-6 py-8">{children}</main>
          </div>
        </Providers>
      </body>
    </html>
  );
}
