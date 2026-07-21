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
    process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3002",
  ),
  title: "ZeSuite — Tous vos outils, un seul compte",
  description:
    "Découvrez ZeRecruit, ZeControl et les futurs produits ZeSuite. Une organisation, un compte et des outils spécialisés.",
  openGraph: {
    type: "website",
    locale: "fr_FR",
    siteName: "ZeSuite",
    title: "ZeSuite — Tous vos outils, un seul compte",
    description:
      "Une organisation, un compte et des produits spécialisés pour vos équipes.",
    images: [
      {
        url: "/og.png",
        width: 1727,
        height: 910,
        alt: "ZeSuite — Tous vos outils, un seul compte",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "ZeSuite — Tous vos outils, un seul compte",
    description:
      "Une organisation, un compte et des produits spécialisés pour vos équipes.",
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
