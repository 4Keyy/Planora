import fs from "node:fs"
import path from "node:path"
import { renderToStaticMarkup } from "react-dom/server"
import sharp from "sharp"
import { describe, expect, it } from "vitest"
import { Wordmark } from "@/components/ui/wordmark"
import { tokens } from "@/lib/design-tokens"
import manifest from "@/app/manifest"

const root = process.cwd()
const svgDocument = (source: string) => new DOMParser().parseFromString(source, "image/svg+xml")

describe("one Planora mark across UI and exported assets", () => {
  it.each(["public/favicon.svg", "../docs/assets/logo.svg"])("keeps %s identical to the navbar geometry", (file) => {
    const exported = svgDocument(fs.readFileSync(path.join(root, file), "utf8"))
    const navbar = new DOMParser().parseFromString(renderToStaticMarkup(<Wordmark showName={false} />), "text/html")

    expect(exported.querySelector("svg")?.getAttribute("viewBox"))
      .toBe(navbar.querySelector("svg")?.getAttribute("viewBox"))
    const circles = exported.querySelectorAll("circle")
    expect(circles).toHaveLength(2)
    navbar.querySelectorAll("circle").forEach((circle, index) => {
      for (const attribute of ["cx", "cy", "r", "stroke-width", "stroke-linecap", "pathLength", "stroke-dasharray", "stroke-dashoffset", "transform"]) {
        expect(circles[index].getAttribute(attribute), `${file}: ${attribute}`).toBe(circle.getAttribute(attribute))
      }
    })
    expect(exported.querySelectorAll("rect, path, image")).toHaveLength(0)
  })

  it.each(["public/favicon.svg", "../docs/assets/logo.svg"])("adapts %s using only ink and paper", (file) => {
    const document = svgDocument(fs.readFileSync(path.join(root, file), "utf8"))
    const css = document.querySelector("style")!.textContent!
    expect(css).toContain(`:root { color: ${tokens.color.ink}; }`)
    expect(css).toContain(`@media (prefers-color-scheme: dark) { :root { color: ${tokens.color.paper}; } }`)
    expect(document.querySelectorAll("circle")[0].getAttribute("stroke")).toBe("currentColor")
    expect(document.querySelectorAll("circle")[1].getAttribute("fill")).toBe("currentColor")
  })

  it.each([
    ["icon-32.png", 32], ["apple-touch-icon.png", 180], ["icon-192.png", 192], ["icon-512.png", 512],
  ] as const)("renders %s at %s pixels with the same top cut and central dot", async (file, size) => {
    const image = sharp(path.join(root, "public", file))
    expect(await image.metadata()).toMatchObject({ width: size, height: size, format: "png" })
    const { data, info } = await image.removeAlpha().raw().toBuffer({ resolveWithObject: true })
    const pixel = (x: number, y: number) => {
      const offset = (Math.floor(y * size / 32) * size + Math.floor(x * size / 32)) * info.channels
      return `#${data.subarray(offset, offset + 3).toString("hex")}`
    }
    expect(pixel(16, 16)).toBe(tokens.color.ink) // you
    expect(pixel(25, 16)).toBe(tokens.color.ink) // ring
    expect(pixel(16, 7)).toBe(tokens.color.paper) // twelve-o'clock cut
    expect(pixel(0, 0)).toBe(tokens.color.paper) // tile
  })

  it("uses those same PNGs for normal and maskable installation icons", () => {
    const metadata = manifest()
    expect(metadata).toMatchObject({ name: "Planora", background_color: tokens.color.paper, theme_color: tokens.color.paper })
    expect(metadata.icons).toEqual([
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ])
  })
})
