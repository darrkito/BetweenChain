"use client";

import { motion } from "motion/react";
import type { ReactNode } from "react";
import { usePrefersReducedMotion } from "@/lib/client/usePrefersReducedMotion";

// 2026-08-05 (Phase 5, visual polish) — scroll-reveal for below-the-fold
// landing page sections. Transform/opacity only (no layout-affecting
// properties) so this stays 60fps and never triggers reflow. `once: true`
// means each section animates in a single time, not every time it
// re-enters the viewport on scroll-up (distracting, not "polished").
// `usePrefersReducedMotion` (lib/client/usePrefersReducedMotion.ts) skips
// the animation for users who've asked the OS for it — same accessibility
// bar as prefers-color-scheme handling elsewhere in this app, but resolved
// in a way that can't cause a hydration mismatch (see that hook's own
// comment for why motion/react's own useReducedMotion() isn't safe to
// branch DOM structure on directly).
export function Reveal({ children, delay = 0, className }: { children: ReactNode; delay?: number; className?: string }) {
  const reduceMotion = usePrefersReducedMotion();

  if (reduceMotion) return <div className={className}>{children}</div>;

  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 16 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-80px" }}
      transition={{ duration: 0.5, ease: "easeOut", delay }}
    >
      {children}
    </motion.div>
  );
}
