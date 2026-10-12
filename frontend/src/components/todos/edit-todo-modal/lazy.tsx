"use client"

import { useEffect, useState } from "react"
import type { EditTodoModalProps } from "./modal"

type EditorModule = typeof import("./index")

/** The editor's module once it has loaded: from then on it renders without waiting. */
let loaded: EditorModule | null = null

/**
 * The task editor's chunk, from one `import()`.
 *
 * Every screen used to declare its own `dynamic(() => import(...))`, and warming the editor ahead
 * of time imported it from yet another place. The bundler gives each `import()` its own async
 * chunk, so the warm-up fetched a copy of the editor that the dialog never asked for, and the
 * first open still waited for its own chunk (measured, 2026-10-12). One import, shared by the
 * dialog and the warm-up (`useWarmEditor`), is one chunk.
 */
export const loadEditor = (): Promise<EditorModule> =>
  import("./index").then((module) => {
    loaded = module
    return module
  })

/**
 * The editor dialog, loaded on first use from the chunk `loadEditor` warms.
 *
 * Not `next/dynamic`: that is `React.lazy`, which suspends on its first render even when the
 * module is already in memory, and React holds back what replaces a fallback for 300ms — so the
 * first open of every session appeared 300ms after the press however warm the chunk was, and
 * every later one in 25ms (measured, 2026-10-13). A loaded module renders here at once; one
 * still on its way renders the moment it arrives, with nothing shown in between, as before.
 */
export function LazyEditTodoModal(props: EditTodoModalProps) {
  const [editor, setEditor] = useState<EditorModule | null>(loaded)
  useEffect(() => {
    if (editor) return
    let live = true
    loadEditor().then(
      (module) => {
        if (live) setEditor(module)
      },
      () => {
        // The chunk could not be fetched (offline, a deploy in between): the dialog gives up
        // its place, so the next press asks for it again instead of finding it stuck.
        if (live) props.onClose()
      },
    )
    return () => {
      live = false
    }
    // Asked for once per mount; `onClose` is read when the load settles.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor])
  if (!editor) return null
  return <editor.EditTodoModal {...props} />
}
