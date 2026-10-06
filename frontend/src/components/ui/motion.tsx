"use client"

import { createElement, forwardRef, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ForwardRefExoticComponent, type RefAttributes } from "react"
import {
  isMotionValue, motion as framerMotion, useMotionValue,
  type AnimationDefinition, type HTMLMotionProps, type MotionProps, type Variants,
} from "framer-motion"

type StableTag = "div" | "span" | "button" | "form" | "article" | "header" | "li" | "p" | "nav" | "kbd"
const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect

const hasOpacity = (definition: unknown): boolean =>
  typeof definition === "object" && definition !== null && "opacity" in definition

function stylesheetOpacity(node: HTMLElement): number {
  const value = Number.parseFloat(getComputedStyle(node).opacity)
  return Number.isFinite(value) ? value : 1
}

function animatesOpacity(props: MotionProps): boolean {
  if ([props.initial, props.animate, props.exit, props.whileHover, props.whileTap,
    props.whileFocus, props.whileDrag, props.whileInView].some(hasOpacity)) return true
  // Controls and variant functions resolve their targets after render.
  if (typeof props.animate === "object" && props.animate !== null && "start" in props.animate) return true
  return Object.values(props.variants ?? {}).some(variant => typeof variant === "function" || hasOpacity(variant))
}

/**
 * Framer 11 cancels its native opacity animation before the final DOM style is
 * rendered. An externally created MotionValue stays on the frame renderer, so
 * entrance and exit opacity never fall back to their starting value for a frame.
 * The existing targets, springs, layout projection and gesture handling stay native.
 */
function stable<Tag extends StableTag>(tag: Tag) {
  type Element = HTMLElementTagNameMap[Tag]
  type Props = HTMLMotionProps<Tag>
  const Native = framerMotion[tag] as ForwardRefExoticComponent<MotionProps & RefAttributes<Element>>
  const Stable = forwardRef<Element, Props>(function StableMotion(forwardedProps, ref) {
    const props = forwardedProps as Props
    const rawOpacity = props.style?.opacity
    const opacity = useMotionValue<number | string | undefined>(typeof rawOpacity === "number" || typeof rawOpacity === "string" ? rawOpacity : undefined)
    const nodeRef = useRef<Element | null>(null)
    const [cssBase, setCssBase] = useState<number>()
    const stableOpacity = animatesOpacity(props) && !isMotionValue(rawOpacity)
    const domRef = useCallback((node: Element | null) => {
      nodeRef.current = node
      if (typeof ref === "function") ref(node)
      else if (ref) ref.current = node
    }, [ref])
    const seedOpacity = useCallback(() => {
      const node = nodeRef.current
      if (!node || opacity.get() !== undefined) return
      opacity.set(stylesheetOpacity(node), false)
    }, [opacity])
    useIsomorphicLayoutEffect(() => {
      if (!stableOpacity || rawOpacity !== undefined || !nodeRef.current || opacity.get() !== undefined || props.variants || hasOpacity(props.animate)) return
      // Read the stylesheet while the missing opacity is still omitted from
      // inline styles. Never replace a resolved initial/inherited/controlled value.
      setCssBase(stylesheetOpacity(nodeRef.current))
    }, [stableOpacity, rawOpacity, opacity, props.variants, props.animate])
    const variants = useMemo(() => {
      if (!props.variants || !stableOpacity) return props.variants
      const result: Variants = {}
      for (const [name, variant] of Object.entries(props.variants)) {
        result[name] = typeof variant === "function" ? (custom, current, velocity) => {
          const target = variant(custom, current, velocity)
          if (hasOpacity(target)) seedOpacity()
          return target
        } : variant
      }
      return result
    }, [props.variants, stableOpacity, seedOpacity])
    const onAnimationStart = (definition: AnimationDefinition) => {
      const labels = typeof definition === "string" ? [definition] : Array.isArray(definition) ? definition : []
      if (hasOpacity(definition) || labels.some(label => hasOpacity(props.variants?.[label]))) seedOpacity()
      props.onAnimationStart?.(definition)
    }
    // A geometry-only motion element must retain CSS hover/disabled opacity and
    // ordinary numeric style updates. A caller's MotionValue is theirs to own.
    if (!stableOpacity) return createElement(Native, { ...props, ref: domRef })

    // A changing numeric base must remain the resting target after a hover fade.
    // Explicit/inherited variants and imperative controls already own their targets.
    const baseOpacity = typeof rawOpacity === "number" || typeof rawOpacity === "string" ? rawOpacity : cssBase
    const restingTarget = typeof props.animate === "object" && props.animate !== null && !("start" in props.animate) ? props.animate : undefined
    const canSetBase = baseOpacity !== undefined && !props.variants && (props.animate === undefined || restingTarget !== undefined)
    const animate = canSetBase ? { opacity: baseOpacity, ...restingTarget } : props.animate

    return createElement(Native, { ...props, ref: domRef, animate, variants, onAnimationStart, style: { ...props.style, opacity } })
  })
  Stable.displayName = `StableMotion.${tag}`
  return Stable
}

/** The product's existing DOM motion tags, with stable opacity where it animates. */
export const motion = {
  div: stable("div"), span: stable("span"), button: stable("button"),
  form: stable("form"), article: stable("article"), header: stable("header"),
  li: stable("li"), p: stable("p"), nav: stable("nav"), kbd: stable("kbd"),
  // Native opacity acceleration only applies to HTMLElements; SVG is unaffected.
  circle: framerMotion.circle, line: framerMotion.line, path: framerMotion.path,
  svg: framerMotion.svg,
}
