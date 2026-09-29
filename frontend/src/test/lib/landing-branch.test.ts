import { describe, expect, it } from "vitest"
import {
  branchStage,
  chapterAfterPress,
  CHAPTERS,
  LAST_CHAPTER,
  stepActionLabel,
} from "@/lib/landing-branch"

/**
 * The branch story on the landing page (block 6). Each chapter may only add at the bottom of
 * the picture or change the step already there, and the step's circle follows the product's
 * own cycle — idle, working, done, reopened.
 */

describe("branchStage", () => {
  it("opens on the author's note alone", () => {
    expect(branchStage(1)).toEqual({ note: true, message: false, reply: false, step: null, completion: false })
  })

  it("only ever adds as the chapters go on — nothing shown earlier disappears later", () => {
    const shown = (c: number) => {
      const s = branchStage(c)
      return [s.note, s.message, s.reply, s.step !== null, s.completion]
    }
    for (let c = 2; c <= LAST_CHAPTER; c++) {
      shown(c - 1).forEach((was, i) => {
        if (was) expect(shown(c)[i]).toBe(true)
      })
    }
  })

  it("moves the step from idle to working to done over chapters four to six", () => {
    expect([4, 5, 6].map((c) => branchStage(c).step)).toEqual(["idle", "working", "done"])
    expect(branchStage(6).completion).toBe(true)
    expect(branchStage(5).completion).toBe(false)
  })

  it("clamps anything out of range instead of drawing a broken branch", () => {
    expect(branchStage(0)).toEqual(branchStage(1))
    expect(branchStage(99)).toEqual(branchStage(LAST_CHAPTER))
    expect(branchStage(Number.NaN)).toEqual(branchStage(1))
  })
})

describe("the step's circle", () => {
  it("takes an idle step into work, finishes a working one and reopens a finished one", () => {
    expect(branchStage(chapterAfterPress("idle")).step).toBe("working")
    expect(branchStage(chapterAfterPress("working")).step).toBe("done")
    expect(branchStage(chapterAfterPress("done")).step).toBe("idle")
  })

  it("names what a press will do", () => {
    expect(stepActionLabel("idle")).toBe("Take the step into work")
    expect(stepActionLabel("working")).toBe("Finish the step")
    expect(stepActionLabel("done")).toBe("Reopen the step")
  })
})

describe("CHAPTERS", () => {
  it("tells six chapters, each with a title and one line", () => {
    expect(CHAPTERS).toHaveLength(LAST_CHAPTER)
    expect(LAST_CHAPTER).toBe(6)
    for (const c of CHAPTERS) {
      expect(c.title.length).toBeGreaterThan(0)
      expect(c.line.endsWith(".")).toBe(true)
    }
  })
})
