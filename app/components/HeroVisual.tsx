"use client";

import { motion, useReducedMotion } from "motion/react";

// 2026-08-05 (Phase 5, visual polish) — the one hero visual this pass adds,
// deliberately staying lightweight: a bigger version of the existing
// three-node wordmark icon (app/components/AppHeader.tsx), not a new asset
// or a 3D/WebGL scene. Lines draw in via strokeDashoffset (transform/paint
// only, no layout thrash), nodes fade+scale in with a stagger, and the
// center node holds a very subtle infinite pulse once settled. Renders its
// static (non-animated) SVG on the server like any client component, then
// hydrates into the animated version — never blocks the hero text's own
// first paint, which is plain server-rendered markup right next to it.
const LINE_LENGTH = 10; // approx length of each connecting line segment, for strokeDasharray

export function HeroVisual() {
  const reduceMotion = useReducedMotion();

  if (reduceMotion) {
    return (
      <svg width="120" height="120" viewBox="0 0 26 26" fill="none" aria-hidden="true" className="shrink-0">
        <circle cx="6" cy="6" r="2.4" fill="var(--ink-faint)" />
        <circle cx="20" cy="6" r="2.4" fill="var(--ink-faint)" />
        <circle cx="6" cy="20" r="2.4" fill="var(--ink-faint)" />
        <path d="M6 6 13 13M20 6 13 13M6 20 13 13" stroke="var(--ink-faint)" strokeWidth="1.6" strokeLinecap="round" opacity="0.6" />
        <circle cx="13" cy="13" r="4.2" fill="var(--accent)" />
      </svg>
    );
  }

  return (
    <motion.svg
      width="120"
      height="120"
      viewBox="0 0 26 26"
      fill="none"
      aria-hidden="true"
      className="shrink-0"
      initial="hidden"
      animate="visible"
    >
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
  );
}
