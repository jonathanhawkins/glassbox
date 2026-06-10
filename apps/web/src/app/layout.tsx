import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  display: "swap",
  preload: false,
});

// Canonical origin for absolute OG/Twitter image URLs. Env-driven so a deploy
// can point it at the real host; falls back to the cockpit dev port (3100).
const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3100";
const description =
  "Watch a self-improving swarm build real code, graded against ground truth.";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: "Glassbox",
  description,
  openGraph: {
    title: "Glassbox",
    description,
    url: siteUrl,
    siteName: "Glassbox",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Glassbox",
    description,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="h-full min-h-full bg-canvas text-ink-mid">
        {children}
      </body>
    </html>
  );
}
