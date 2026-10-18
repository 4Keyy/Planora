import type { MetadataRoute } from "next"
import { tokens } from "@/lib/design-tokens"

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Planora",
    short_name: "Planora",
    start_url: "/",
    display: "standalone",
    background_color: tokens.color.paper,
    theme_color: tokens.color.paper,
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  }
}
