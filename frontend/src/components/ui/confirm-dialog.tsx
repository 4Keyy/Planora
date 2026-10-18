"use client"

import * as React from "react"
import { AlertTriangle, X } from "lucide-react"
import { Button } from "./button"
import type { ButtonProps } from "./button"
import { Overlay } from "./overlay"

interface ConfirmDialogProps {
    isOpen: boolean
    onClose: () => void
    /** Receives whether the "don't ask again" box was ticked (always false when no checkbox is shown). */
    onConfirm: (dontAskAgain: boolean) => void
    title: string
    description: string
    confirmText?: string
    cancelText?: string
    variant?: "danger" | "warning" | "info"
    /** When provided, renders a "don't show again" checkbox whose state is passed to onConfirm. */
    dontAskAgainLabel?: string
}

export function ConfirmDialog({
    isOpen,
    onClose,
    onConfirm,
    title,
    description,
    confirmText = "Confirm",
    cancelText = "Cancel",
    variant = "danger",
    dontAskAgainLabel,
}: ConfirmDialogProps) {

    // Local "don't ask again" state, reset every time the dialog (re)opens so a prior tick never leaks
    // into the next prompt.
    const [dontAskAgain, setDontAskAgain] = React.useState(false)
    React.useEffect(() => {
        if (isOpen) setDontAskAgain(false)
    }, [isOpen])

    const titleId = React.useId()
    const descId = React.useId()

    const stylesByVariant: Record<NonNullable<ConfirmDialogProps["variant"]>, {
        bg: string
        icon: string
        button: ButtonProps["variant"]
        border: string
    }> = {
        danger: {
            bg: "bg-alert-surface",
            icon: "text-alert",
            button: "destructive",
            border: "border-alert-surface",
        },
        warning: {
            bg: "bg-warn-surface",
            icon: "text-warn",
            button: "default",
            border: "border-warn-surface",
        },
        info: {
            bg: "bg-accent-surface",
            icon: "text-accent",
            button: "accent",
            border: "border-accent-surface",
        },
    }
    const variantStyles = stylesByVariant[variant]

    return (
        <Overlay
            open={isOpen}
            onClose={onClose}
            hideHeader
            labelledBy={titleId}
            describedBy={descId}
            className="max-w-sm border border-line p-6"
        >
            <div className="flex items-start gap-4">
                <div className={`h-12 w-12 rounded-xl flex items-center justify-center flex-shrink-0 ${variantStyles.bg} ${variantStyles.border} border`}>
                    <AlertTriangle className={`h-6 w-6 ${variantStyles.icon}`} />
                </div>
                <div className="flex-1">
                    <h3 id={titleId} className="text-title-sm font-bold text-ink leading-tight mb-2">{title}</h3>
                    <p id={descId} className="text-body-sm text-ink-subtle leading-relaxed">{description}</p>
                </div>
                <button onClick={onClose} aria-label="Close" className="h-8 w-8 rounded-md hover:bg-paper-sunken flex items-center justify-center text-ink-subtle">
                    <X className="h-4 w-4" />
                </button>
            </div>

            {dontAskAgainLabel && (
                <label className="flex items-center gap-2.5 mt-6 cursor-pointer select-none">
                    <input
                        type="checkbox"
                        checked={dontAskAgain}
                        onChange={(e) => setDontAskAgain(e.target.checked)}
                        className="h-4 w-4 rounded border-line-strong text-ink cursor-pointer"
                    />
                    <span className="text-body-sm text-ink-muted">{dontAskAgainLabel}</span>
                </label>
            )}

            <div className={`flex gap-3 ${dontAskAgainLabel ? "mt-4" : "mt-8"}`}>
                <Button variant="secondary" className="flex-1 rounded-xl" onClick={onClose}>
                    {cancelText}
                </Button>
                <Button
                    variant={variantStyles.button}
                    className="flex-1 rounded-xl font-bold"
                    onClick={() => {
                        onConfirm(dontAskAgain)
                        onClose()
                    }}
                >
                    {confirmText}
                </Button>
            </div>
        </Overlay>
    )
}
