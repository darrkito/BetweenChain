// Small "pro-tip" reading aid, distinct from Callout (BlogComponents.tsx,
// a CTA button box) — 2026-08-07 blog tutorial-hub upgrade. `children` is
// MDX-parsed markdown text, already wrapped in MDX's own <p> — this wrapper
// uses a <div>, not a <p>, for the same reason Callout does (see that
// file's own comment: a <p> inside a <p> is invalid HTML, found live once).
export function BlogTip({ children }: { children: React.ReactNode }) {
  return (
    <div className="my-2 flex gap-2 rounded-xl border border-hairline bg-surface-hover px-4 py-3 text-sm text-ink-muted">
      <span aria-hidden="true">💡</span>
      <div>{children}</div>
    </div>
  );
}
