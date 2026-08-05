// Structured data (JSON-LD) — one small, dependency-free module rather than
// a library like schema-dts. Ported from /home/darrkito/luvory-genius-generator's
// SEOHead.tsx @graph pattern (that project's own real, working SEO setup —
// confirmed via a full audit this session), adapted from its Vite+prerender
// mechanism to Next.js's native Metadata API/Server Components, which cover
// the same ground natively. No SEO framework needed here either.
import type { BreadcrumbItem } from "@/app/components/Breadcrumb";

const SITE_URL = "https://blockchains.click";
const SITE_NAME = "Blockchains.Click";

/**
 * Renders a single JSON-LD <script> tag. `data` is always built from our own
 * typed builder functions below (never raw user input), but the `<` escape
 * is still real defense-in-depth against a `</script>`-breakout if any
 * upstream vendor string (an NFT collection name/description, for example)
 * ever contains it — cheap to do, no reason not to.
 */
export function JsonLd({ data }: { data: object }) {
  const json = JSON.stringify(data).replace(/</g, "\\u003c");
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: json }} />;
}

/**
 * Site-wide identity — rendered once in the root layout, referenced by
 * @id from every other schema below (same cross-linking pattern Luvory's
 * @graph used). No physical address/LocalBusiness fields (unlike Luvory,
 * a real local business) — this is a software product, plain Organization.
 */
export function organizationSchema() {
  return {
    "@type": "Organization",
    "@id": `${SITE_URL}/#organization`,
    name: SITE_NAME,
    url: SITE_URL,
    logo: `${SITE_URL}/icon-512.png`,
  };
}

export function websiteSchema() {
  return {
    "@type": "WebSite",
    "@id": `${SITE_URL}/#website`,
    url: SITE_URL,
    name: SITE_NAME,
    publisher: { "@id": `${SITE_URL}/#organization` },
    potentialAction: {
      "@type": "SearchAction",
      target: { "@type": "EntryPoint", urlTemplate: `${SITE_URL}/nft?family=solana&q={search_term_string}` },
      "query-input": "required name=search_term_string",
    },
  };
}

/** Root-level @graph — rendered once in app/layout.tsx, covers every page. */
export function siteGraphSchema() {
  return { "@context": "https://schema.org", "@graph": [organizationSchema(), websiteSchema()] };
}

/**
 * Same `items` shape app/components/Breadcrumb.tsx already renders visually
 * — one source of truth feeding both outputs, same pattern Luvory's
 * BreadcrumbNav+SEOHead pairing used. The last item (current page, no href)
 * still needs a real URL for JSON-LD, which `currentUrl` supplies.
 */
export function breadcrumbListSchema(items: BreadcrumbItem[], currentUrl: string) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: item.label,
      item: item.href ? `${SITE_URL}${item.href}` : currentUrl,
    })),
  };
}

export function faqPageSchema(qas: Array<{ question: string; answer: string }>) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: qas.map((qa) => ({
      "@type": "Question",
      name: qa.question,
      acceptedAnswer: { "@type": "Answer", text: qa.answer },
    })),
  };
}

export interface ArticleSchemaInput {
  title: string;
  description: string;
  slug: string;
  datePublished: string; // ISO 8601
  dateModified?: string;
  image?: string;
}

export function articleSchema(post: ArticleSchemaInput) {
  return {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: post.title,
    description: post.description,
    url: `${SITE_URL}/blog/${post.slug}`,
    datePublished: post.datePublished,
    dateModified: post.dateModified ?? post.datePublished,
    image: post.image ? [post.image] : undefined,
    author: { "@id": `${SITE_URL}/#organization` },
    publisher: { "@id": `${SITE_URL}/#organization` },
    mainEntityOfPage: { "@type": "WebPage", "@id": `${SITE_URL}/blog/${post.slug}` },
  };
}
