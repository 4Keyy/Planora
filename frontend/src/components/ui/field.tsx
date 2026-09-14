"use client"

import * as React from "react"
import { cn } from "@/lib/utils"

/**
 * Label, control, hint and error — wired together correctly, once.
 *
 * The product had four of these. `FieldGroup` on the profile page had no error
 * slot at all. `InputField` on the register page had one, but rendered the error
 * *inside* the `<label>`, so a screen reader read "Email Passwords don't match"
 * as the field's name and there was no `aria-invalid` to say the field was in an
 * error state. The login page wired `htmlFor` by hand against ids typed out as
 * string literals in two places. The categories page had a fourth label style
 * (`tracking-widest` against everyone else's `tracking-wider`).
 *
 * The associations this component guarantees, which are the whole reason it
 * exists:
 *
 * - the label is associated with the control through a generated id, so clicking
 *   the label focuses the control and a screen reader announces the name;
 * - the hint and the error are referenced by `aria-describedby`, so they are read
 *   AFTER the name rather than becoming part of it;
 * - `aria-invalid` marks the control itself, which is what assistive tech uses to
 *   announce "invalid entry" — a red border communicates nothing without it;
 * - the error carries `role="alert"`, because it appears after a submit the user
 *   has already made and would otherwise go unannounced.
 *
 * The control is supplied as a render prop rather than as children, so the props
 * that carry those associations cannot be silently dropped:
 *
 *   <Field label="Email" error={errors.email?.message}>
 *     {(props) => <Input {...props} type="email" autoComplete="email" />}
 *   </Field>
 */

/** Exactly the props a control must spread to be correctly associated. */
export interface FieldControlProps {
  id: string
  "aria-describedby": string | undefined
  "aria-invalid": true | undefined
  required: boolean | undefined
}

export interface FieldProps {
  label: string
  /** Rendered under the control, and referenced by `aria-describedby`. */
  hint?: React.ReactNode
  /** Present means invalid: sets `aria-invalid` and announces through `role="alert"`. */
  error?: string | null
  required?: boolean
  /**
   * Hides the label visually while leaving it in the accessibility tree. Use only
   * where an adjacent visible heading already names the field — never merely to
   * save space, because a placeholder disappears the moment the user types.
   */
  labelHidden?: boolean
  className?: string
  children: (props: FieldControlProps) => React.ReactNode
}

/** One label style for the whole product. */
export const FIELD_LABEL_CLASS =
  "block text-caption font-semibold uppercase tracking-wider text-ink-muted"

export function Field({
  label,
  hint,
  error,
  required,
  labelHidden,
  className,
  children,
}: FieldProps) {
  const id = React.useId()
  const hintId = hint ? `${id}-hint` : undefined
  const errorId = error ? `${id}-error` : undefined
  // Order matters: a screen reader reads the descriptions in the order listed,
  // and the error is the more urgent of the two.
  const describedBy = [errorId, hintId].filter(Boolean).join(" ") || undefined

  return (
    <div className={cn("space-y-2", className)}>
      <label htmlFor={id} className={cn(FIELD_LABEL_CLASS, labelHidden && "sr-only")}>
        {label}
        {required ? (
          <span className="ml-1 text-alert" aria-hidden="true">
            *
          </span>
        ) : null}
      </label>

      {children({
        id,
        "aria-describedby": describedBy,
        "aria-invalid": error ? true : undefined,
        required: required || undefined,
      })}

      {error ? (
        <p id={errorId} role="alert" className="text-caption font-medium text-alert">
          {error}
        </p>
      ) : null}

      {hint ? (
        <p id={hintId} className="text-caption font-medium text-ink-subtle">
          {hint}
        </p>
      ) : null}
    </div>
  )
}
