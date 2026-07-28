/**
 * Root layout: sidebar navigation + main content area.
 */
import type { Metadata } from "next";
import "./globals.css";
import { Sidebar } from "@/components/sidebar";
import { Providers } from "@/components/providers";

export const metadata: Metadata = {
  title: "WatchingEye",
  description: "Deterministic edge vision platform — every decision explained.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="antialiased">
        <Providers>
          <div className="flex min-h-screen">
            <Sidebar />
            <main className="flex-1 overflow-x-hidden p-6">{children}</main>
          </div>
        </Providers>
      </body>
    </html>
  );
}
