import type { Metadata } from "next";
import { DM_Sans, Manrope } from "next/font/google";
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
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"),
  title: {
    default: "ZeRecruit — Trouvez les talents cachés dans votre CVthèque",
    template: "%s | ZeRecruit",
  },
  description:
    "Importez vos CV, structurez les profils avec l’IA et trouvez les meilleurs candidats grâce à une recherche intelligente et un matching explicable.",
  keywords: ["recrutement", "CVthèque", "recherche candidats", "IA RH", "matching candidat"],
  openGraph: {
    type: "website",
    locale: "fr_FR",
    siteName: "ZeRecruit",
    title: "ZeRecruit — Votre prochain grand talent est déjà dans vos CV",
    description: "Transformez votre CVthèque en moteur de recherche intelligent.",
    images: [{ url: "/og.png", width: 1720, height: 906, alt: "ZeRecruit — Votre prochain grand talent est déjà dans vos CV" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "ZeRecruit — Votre prochain grand talent est déjà dans vos CV",
    description: "Transformez votre CVthèque en moteur de recherche intelligent.",
    images: ["/og.png"],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="fr" className={`${displayFont.variable} ${bodyFont.variable}`}>
      <body>{children}</body>
    </html>
  );
}
