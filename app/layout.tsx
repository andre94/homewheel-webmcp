import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  applicationName: "HomeWheel",
  title: {
    default: "HomeWheel — Make room for real movement",
    template: "%s · HomeWheel",
  },
  description:
    "A wheelchair-aware room planner where a WebMCP agent proposes measurable changes and the person retains final authority.",
  keywords: [
    "WebMCP",
    "accessibility",
    "wheelchair",
    "room planning",
    "human-agent collaboration",
  ],
  authors: [{ name: "Andrea Balbo" }],
  category: "technology",
  openGraph: {
    title: "HomeWheel — Make room for real movement",
    description:
      "The agent optimizes geometry. The person defines what a good room means.",
    type: "website",
    siteName: "HomeWheel",
  },
  robots: {
    index: true,
    follow: true,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
