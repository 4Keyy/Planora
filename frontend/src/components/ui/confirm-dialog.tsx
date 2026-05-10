"use client"

import * as React from "react"
import { motion, AnimatePresence } from "framer-motion"
import { AlertTriangle, X } from "lucide-react"
import { Button } from "./button"
import type { ButtonProps } from "./button"
import { ModalPortal } from "./modal-portal"
import { SPRING_STANDARD, TWEEN_BACKDROP } from "@/lib/animations"

interface ConfirmDialogProps {
    isOpen: boolean
    onClose: () => void
    onConfirm: () => void
    title: string
    description: string
    confirmText?: string
    cancelText?: string
    variant?: "danger" | "warning" | "info"
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
}: ConfirmDialogProps) {

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
                            initial={{ opacity: 0, scale: 0.95, y: 16 }}
                            animate={{ opacity: 1, scale: 1, y: 0 }}
                            exit={{ opacity: 0, scale: 0.95, y: 16 }}
                            transition={SPRING_STANDARD}
                            className="relative w-full max-w-sm rounded-3xl border border-gray-100 bg-white p-6 shadow-2xl z-10"
                        >
                            <div className="flex items-start gap-4">
                                <div className={`h-12 w-12 rounded-2xl flex items-center justify-center flex-shrink-0 ${variantStyles.bg} ${variantStyles.border} border`}>
                                    <AlertTriangle className={`h-6 w-6 ${variantStyles.icon}`} />
                                </div>
                                <div className="flex-1">
                                    <h3 className="text-xl font-bold text-gray-900 leading-tight mb-2">{title}</h3>
                                    <p className="text-sm text-gray-500 leading-relaxed">{description}</p>
                                </div>
                                <button onClick={onClose} className="h-8 w-8 rounded-lg hover:bg-gray-50 flex items-center justify-center text-gray-400">
                                    <X className="h-4 w-4" />
                                </button>
                            </div>

                            <div className="flex gap-3 mt-8">
                                <Button variant="secondary" className="flex-1 rounded-2xl" onClick={onClose}>
                                    {cancelText}
                                </Button>
                                <Button
                                    variant={variantStyles.button}
                                    className="flex-1 rounded-2xl font-bold"
                                    onClick={() => {
                                        onConfirm()
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
