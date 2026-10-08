import type { Metadata } from "next"
import { NotFoundScene } from "@/components/errors/scenes"

export const metadata: Metadata = {
  title: "Page not found",
}

/**
 * Every address that matches no page, and every `notFound()`. It used to be Next's own
 * "404 | This page could not be found." in black on white, with nothing to do but edit the
 * address bar; now it is Planora's — see `components/errors`.
 */
export default function NotFound() {
  return <NotFoundScene />
}
