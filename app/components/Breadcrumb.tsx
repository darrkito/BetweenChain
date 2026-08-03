import Link from "next/link";

export interface BreadcrumbItem {
  label: string;
  href?: string;
}

// Trail like "NFTs > Ethereum > Pudgy Penguins" — last item (current page)
// has no href and renders as plain text, everything before it is a link.
export function Breadcrumb({ items }: { items: BreadcrumbItem[] }) {
  return (
    <nav className="flex flex-wrap items-center gap-1.5 px-1 text-[13px]">
      {items.map((item, i) => (
        <span key={i} className="flex items-center gap-1.5">
          {i > 0 && <span className="text-ink-faint">/</span>}
          {item.href ? (
            <Link href={item.href} className="text-ink-muted transition-colors hover:text-accent">
              {item.label}
            </Link>
          ) : (
            <span className="font-medium text-ink">{item.label}</span>
          )}
        </span>
      ))}
    </nav>
  );
}
