import type { Metadata } from "next";
import { DM_Sans, Manrope } from "next/font/google";
import "@ze/ui-foundations/brands.css";
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
  description:
    "Suivez les présences, les retards et le temps de travail avec une expérience simple sur mobile, tablette et desktop, même lorsque le réseau est instable.",
  keywords: [
    "pointage",
    "gestion des présences",
    "temps de travail",
    "application RH",
    "pointage hors connexion",
  ],
  openGraph: {
    type: "website",
    locale: "fr_FR",
    siteName: "ZeControl",
    title: "ZeControl — Le pointage fiable, partout où vous travaillez",
    description:
      "Une expérience simple pour suivre les présences sur mobile, tablette et desktop, même avec un réseau instable.",
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
      "Une expérience simple pour suivre les présences, même avec un réseau instable.",
    images: ["/og.png"],
  },
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
      <body>{children}</body>
    </html>
  );
}
