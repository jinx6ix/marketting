import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/providers";
import { FacebookSdk } from "@/components/facebook-sdk";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });

export const metadata: Metadata = {
  title: {
    default: "Wanderlust Marketing OS",
    template: "%s · Wanderlust Marketing OS",
  },
  description:
    "Full marketing system for travel & tours: create, schedule, publish, monitor socials, and out-strategize competitors.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Deliberately NOT setting maximumScale/userScalable=no — locking zoom
  // out is a common mobile-responsiveness anti-pattern that breaks
  // accessibility for anyone who needs to pinch-zoom text.
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${inter.variable} font-sans antialiased`}>
        <Providers>{children}</Providers>
        <FacebookSdk />
      </body>
    </html>
  );
}