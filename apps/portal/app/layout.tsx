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
  title: "ZeSuite — Vos équipes et vos outils, enfin réunis",
  description:
    "Retrouvez ZeRecruit, ZeControl et les futurs produits ZeSuite dans un espace simple, cohérent et prêt à évoluer.",
  openGraph: {
    type: "website",
    locale: "fr_FR",
    siteName: "ZeSuite",
    title: "ZeSuite — Vos équipes et vos outils, enfin réunis",
    description:
      "Un compte, une organisation et des produits spécialisés pour faire avancer vos équipes.",
    images: [
      {
        url: "/og.png",
        width: 1732,
        height: 908,
        alt: "ZeSuite — Vos équipes et vos outils, enfin réunis",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "ZeSuite — Vos équipes et vos outils, enfin réunis",
    description:
      "Un compte, une organisation et des produits spécialisés pour faire avancer vos équipes.",
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
