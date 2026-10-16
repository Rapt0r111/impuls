import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Стимул",
    short_name: "Стимул",
    description:
      "Рабочее приложение Стимул — платформа мотивации и учёта задач научной роты",
    start_url: "/",
    display: "standalone",
    background_color: "#08151c",
    theme_color: "#08151c",
    icons: [
      { src: "/brand/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/brand/icon-512.png", sizes: "512x512", type: "image/png" },
      {
        src: "/brand/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
