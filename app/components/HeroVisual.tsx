"use client";

import { motion } from "motion/react";
import { usePrefersReducedMotion } from "@/lib/client/usePrefersReducedMotion";

// 2026-08-05 (Phase 5, visual polish) — a bigger version of the existing
// three-node wordmark icon (app/components/AppHeader.tsx), not a new asset
// or a 3D/WebGL scene. Lines draw in via strokeDashoffset (transform/paint
// only, no layout thrash), nodes fade+scale in with a stagger, and the
// center node holds a very subtle infinite pulse once settled. Renders its
// static (non-animated) SVG on the server like any client component, then
// hydrates into the animated version — never blocks the hero text's own
// first paint, which is plain server-rendered markup right next to it.
//
// 2026-08-06 (landing visual pass) — enlarged from 120px to 176px (real
// user report: "make the hero bigger and more dynamic") and given a soft
// blurred accent-colored glow behind it (a plain CSS radial gradient div,
// not an SVG filter — cheaper to paint and easy to fade with prefers-
// reduced-motion / dark mode via the existing --accent token) plus an
// outer ring that slowly rotates once mounted, so the icon reads as "alive"
// even after its one-shot entrance animation settles. Node/line geometry
// (viewBox "0 0 26 26") is untouched — only the rendered width/height and
// the new wrapper elements changed, so none of the animation math below
// needed to move.
const LINE_LENGTH = 10; // approx length of each connecting line segment, for strokeDasharray

function HeroGlow() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 -z-10 rounded-full blur-2xl"
      style={{ background: "radial-gradient(circle, var(--accent-soft) 0%, transparent 70%)" }}
    />
  );
}

export function HeroVisual() {
  const reduceMotion = usePrefersReducedMotion();

  if (reduceMotion) {
    return (
      <div className="relative flex shrink-0 items-center justify-center">
        <HeroGlow />
        <svg width="176" height="176" viewBox="0 0 26 26" fill="none" aria-hidden="true">
          <circle cx="6" cy="6" r="2.4" fill="var(--ink-faint)" />
          <circle cx="20" cy="6" r="2.4" fill="var(--ink-faint)" />
          <circle cx="6" cy="20" r="2.4" fill="var(--ink-faint)" />
          <path d="M6 6 13 13M20 6 13 13M6 20 13 13" stroke="var(--ink-faint)" strokeWidth="1.6" strokeLinecap="round" opacity="0.6" />
          <circle cx="13" cy="13" r="4.2" fill="var(--accent)" />
        </svg>
      </div>
    );
  }

  return (
    <div className="relative flex shrink-0 items-center justify-center">
      <HeroGlow />
      <motion.div
        aria-hidden="true"
        className="absolute inset-0 rounded-full border border-dashed border-accent/25"
        animate={{ rotate: 360 }}
        transition={{ duration: 40, ease: "linear", repeat: Infinity }}
      />
      <motion.svg width="176" height="176" viewBox="0 0 26 26" fill="none" aria-hidden="true" initial="hidden" animate="visible">
        <motion.path
          d="M6 6 13 13M20 6 13 13M6 20 13 13"
          stroke="var(--ink-faint)"
          strokeWidth="1.6"
          strokeLinecap="round"
          opacity="0.6"
          strokeDasharray={LINE_LENGTH}
          variants={{ hidden: { strokeDashoffset: LINE_LENGTH }, visible: { strokeDashoffset: 0 } }}
          transition={{ duration: 0.7, ease: "easeOut", delay: 0.15 }}
        />
        {[
          { cx: 6, cy: 6, delay: 0.5 },
          { cx: 20, cy: 6, delay: 0.6 },
          { cx: 6, cy: 20, delay: 0.7 },
        ].map((n) => (
          <motion.circle
            key={`${n.cx}-${n.cy}`}
            cx={n.cx}
            cy={n.cy}
            r={2.4}
            fill="var(--ink-faint)"
            variants={{ hidden: { opacity: 0, scale: 0 }, visible: { opacity: 1, scale: 1 } }}
            transition={{ duration: 0.3, ease: "easeOut", delay: n.delay }}
          />
        ))}
        {/* Self-contained initial/animate (rather than the shared hidden/visible
            variants above) since this one element also needs an infinite
            repeat for its idle pulse after entrance — mixing that into the
            shared variants would apply the repeat to the whole group. */}
        <motion.circle
          cx={13}
          cy={13}
          r={4.2}
          fill="var(--accent)"
          initial={{ opacity: 0, scale: 0 }}
          animate={{ opacity: 1, scale: [0, 1.15, 1, 1.06, 1] }}
          transition={{ duration: 1.6, ease: "easeOut", delay: 0.85, times: [0, 0.3, 0.5, 0.75, 1], repeat: Infinity, repeatDelay: 2 }}
        />
      </motion.svg>
    </div>
  );
}
