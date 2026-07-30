import type { Metadata, Viewport } from "next";
import { DM_Sans, Manrope } from "next/font/google";
import { PwaLifecycle } from "@/components/pwa/pwa-lifecycle";
import "@ze/ui-foundations/brands.css";
import "leaflet/dist/leaflet.css";
import "./globals.css";

const displayFont = Manrope({
  variable: "--font-display",
  subsets: ["latin"],
});

const bodyFont = DM_Sans({
  variable: "--font-body",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3001",
  ),
  title: "ZeControl — Le pointage fiable, partout où vous travaillez",
  applicationName: "ZeControl",
  manifest: "/manifest.webmanifest",
  description:
    "Suivez les présences, les retards et le temps de travail avec une expérience simple sur mobile, tablette et desktop.",
  keywords: [
    "pointage",
    "gestion des présences",
    "temps de travail",
    "application RH",
    "suivi des équipes",
  ],
  openGraph: {
    type: "website",
    locale: "fr_FR",
    siteName: "ZeControl",
    title: "ZeControl — Le pointage fiable, partout où vous travaillez",
    description:
      "Une expérience simple pour suivre les présences sur mobile, tablette et desktop.",
    images: [
      {
        url: "/og.png",
        width: 1727,
        height: 911,
        alt: "ZeControl — Le pointage fiable, partout où vous travaillez",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "ZeControl — Le pointage fiable, partout où vous travaillez",
    description:
      "Une expérience simple pour suivre les présences et le temps de travail.",
    images: ["/og.png"],
  },
  appleWebApp: {
    capable: true,
    title: "ZeControl",
    statusBarStyle: "black-translucent",
  },
  icons: {
    icon: [
      { url: "/pwa/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/pwa/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [
      { url: "/pwa/apple-touch-icon.png", sizes: "180x180", type: "image/png" },
    ],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#080a0b",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="fr"
      className={`${displayFont.variable} ${bodyFont.variable}`}
      data-scroll-behavior="smooth"
    >
      <body>
        {children}
        <PwaLifecycle />
      </body>
    </html>
  );
}
