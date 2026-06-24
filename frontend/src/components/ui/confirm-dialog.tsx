"use client"

import * as React from "react"
import { motion, AnimatePresence } from "framer-motion"
import { AlertTriangle, X } from "lucide-react"
import { Button } from "./button"
import type { ButtonProps } from "./button"
import { ModalPortal } from "./modal-portal"
import { SPRING_STANDARD, TWEEN_BACKDROP } from "@/lib/animations"
import { useFocusTrap } from "@/hooks/use-focus-trap"

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

    const dialogRef = useFocusTrap<HTMLDivElement>(isOpen)
    const titleId = React.useId()
    const descId = React.useId()

    const stylesByVariant: Record<NonNullable<ConfirmDialogProps["variant"]>, {
        bg: string
        icon: string
        button: ButtonProps["variant"]
        border: string
    }> = {
        danger: {
            bg: "bg-red-50",
            icon: "text-red-600",
            button: "destructive",
            border: "border-red-100",
        },
        warning: {
            bg: "bg-amber-50",
            icon: "text-amber-600",
            button: "default",
            border: "border-amber-100",
        },
        info: {
            bg: "bg-blue-50",
            icon: "text-blue-600",
            button: "accent",
            border: "border-blue-100",
        },
    }
    const variantStyles = stylesByVariant[variant]

    // Close on Escape
    React.useEffect(() => {
        const handleEsc = (e: KeyboardEvent) => {
            if (e.key === "Escape") onClose()
        }
        if (isOpen) window.addEventListener("keydown", handleEsc)
        return () => window.removeEventListener("keydown", handleEsc)
    }, [isOpen, onClose])

    return (
        <ModalPortal>
            <AnimatePresence>
                {isOpen && (
                    <div className="fixed inset-0 z-[2000] flex items-center justify-center p-4">
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            transition={TWEEN_BACKDROP}
                            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
                            onClick={onClose}
                        />
                        <motion.div
                            ref={dialogRef}
                            role="dialog"
                            aria-modal="true"
                            aria-labelledby={titleId}
                            aria-describedby={descId}
                            tabIndex={-1}
                            initial={{ opacity: 0, scale: 0.95, y: 16 }}
                            animate={{ opacity: 1, scale: 1, y: 0 }}
                            exit={{ opacity: 0, scale: 0.95, y: 16 }}
                            transition={SPRING_STANDARD}
                            className="relative w-full max-w-sm rounded-3xl border border-gray-100 bg-white p-6 shadow-2xl z-10 outline-none"
                        >
                            <div className="flex items-start gap-4">
                                <div className={`h-12 w-12 rounded-2xl flex items-center justify-center flex-shrink-0 ${variantStyles.bg} ${variantStyles.border} border`}>
                                    <AlertTriangle className={`h-6 w-6 ${variantStyles.icon}`} />
                                </div>
                                <div className="flex-1">
                                    <h3 id={titleId} className="text-xl font-bold text-gray-900 leading-tight mb-2">{title}</h3>
                                    <p id={descId} className="text-sm text-gray-500 leading-relaxed">{description}</p>
                                </div>
                                <button onClick={onClose} aria-label="Close" className="h-8 w-8 rounded-lg hover:bg-gray-50 flex items-center justify-center text-gray-400">
                                    <X className="h-4 w-4" />
                                </button>
                            </div>

                            {dontAskAgainLabel && (
                                <label className="flex items-center gap-2.5 mt-6 cursor-pointer select-none">
                                    <input
                                        type="checkbox"
                                        checked={dontAskAgain}
                                        onChange={(e) => setDontAskAgain(e.target.checked)}
                                        className="h-4 w-4 rounded border-gray-300 text-gray-900 focus:ring-gray-400 cursor-pointer"
                                    />
                                    <span className="text-sm text-gray-600">{dontAskAgainLabel}</span>
                                </label>
                            )}

                            <div className={`flex gap-3 ${dontAskAgainLabel ? "mt-4" : "mt-8"}`}>
                                <Button variant="secondary" className="flex-1 rounded-2xl" onClick={onClose}>
                                    {cancelText}
                                </Button>
                                <Button
                                    variant={variantStyles.button}
                                    className="flex-1 rounded-2xl font-bold"
                                    onClick={() => {
                                        onConfirm(dontAskAgain)
                                        onClose()
                                    }}
                                >
                                    {confirmText}
                                </Button>
                            </div>
                        </motion.div>
                    </div>
                )}
            </AnimatePresence>
        </ModalPortal>
    )
}
