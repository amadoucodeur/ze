import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/dashboard",
    name: "ZeControl",
    short_name: "ZeControl",
    description:
      "Le pointage et le suivi du temps de travail, simplement.",
    lang: "fr",
    dir: "ltr",
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    orientation: "any",
    launch_handler: {
      client_mode: "navigate-existing",
    },
    prefer_related_applications: false,
    background_color: "#f4f1e9",
    theme_color: "#080a0b",
    categories: ["business", "productivity"],
    icons: [
      {
        src: "/pwa/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/pwa/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/pwa/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
    shortcuts: [
      {
        name: "Pointer",
        short_name: "Pointer",
        description: "Ouvrir mon espace de pointage",
        url: "/dashboard",
        icons: [
          {
            src: "/pwa/icon-192.png",
            sizes: "192x192",
            type: "image/png",
          },
        ],
      },
      {
        name: "Mon activité",
        short_name: "Activité",
        description: "Consulter mes journées et mes rapports",
        url: "/dashboard/mon-activite",
        icons: [
          {
            src: "/pwa/icon-192.png",
            sizes: "192x192",
            type: "image/png",
          },
        ],
      },
      {
        name: "Mon profil",
        short_name: "Profil",
        description: "Ouvrir mes informations et mes droits",
        url: "/dashboard/parametres/profil",
        icons: [
          {
            src: "/pwa/icon-192.png",
            sizes: "192x192",
            type: "image/png",
          },
        ],
      },
    ],
  };
}
