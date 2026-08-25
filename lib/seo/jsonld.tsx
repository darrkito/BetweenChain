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

/**
 * Product-level entity (2026-08-06 GEO pass) — describes the platform's core
 * swap product for AI/answer-engine retrieval. Fee figure matches
 * lib/fees.ts's real JUPITER_FEE_BPS/RELAY_FEE_BPS constants (25 bps each,
 * "per swap leg" — never state a flat total, a cross-chain swap can carry
 * both legs). Rendered globally alongside Organization/WebSite since it
 * describes the whole platform, not one page.
 */
export function financialProductSchema() {
  return {
    "@type": "FinancialProduct",
    "@id": `${SITE_URL}/#product`,
    name: `${SITE_NAME} Cross-Chain Swap`,
    description: "Cross-chain token swap between Solana and EVM chains, with a separate cross-chain NFT marketplace additionally covering Sui.",
    provider: { "@id": `${SITE_URL}/#organization` },
    feesAndCommissionsSpecification: "0.25% platform fee per swap leg, plus the underlying chain's network/gas fee. No other platform fee.",
  };
}

/** Root-level @graph — rendered once in app/layout.tsx, covers every page. */
export function siteGraphSchema() {
  return { "@context": "https://schema.org", "@graph": [organizationSchema(), websiteSchema(), financialProductSchema()] };
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

/**
 * Games Hub (2026-08-07) — real schema.org VideoGame type, same "only
 * include a field when the game's own data actually has it" discipline as
 * nftCollectionBrandSchema above (no padded/guessed sameAs array, no
 * invented genre/publisher when the game doesn't declare one).
 */
export function videoGameSchema(game: {
  slug: string;
  name: string;
  description: string;
  developer: string;
  genre?: string;
  coverImage?: string;
  website?: string;
  twitterUsername?: string;
  discordUrl?: string;
  telegramUrl?: string;
}) {
  const sameAs = [
    game.website,
    game.twitterUsername ? `https://x.com/${game.twitterUsername}` : undefined,
    game.discordUrl,
    game.telegramUrl,
  ].filter((v): v is string => Boolean(v));

  return {
    "@context": "https://schema.org",
    "@type": "VideoGame",
    "@id": `${SITE_URL}/games/${game.slug}#game`,
    name: game.name,
    description: game.description,
    author: { "@type": "Organization", name: game.developer },
    applicationCategory: "Game",
    operatingSystem: "Web Browser",
    ...(game.genre ? { genre: game.genre } : {}),
    ...(game.coverImage ? { image: game.coverImage } : {}),
    ...(sameAs.length > 0 ? { sameAs } : {}),
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
  // 2026-08-08 — named entities (brands/projects/tokens) this post is
  // substantively about, e.g. ["Claynosaurz", "Doggy"]. Real schema.org
  // `mentions` property (Thing[]) — a documented signal search engines and
  // AI answer engines use to associate a page with specific named entities,
  // beyond whatever they infer from prose alone.
  mentions?: string[];
  // 2026-08-25 (ES content expansion) — defaults to "/blog" so every
  // existing English call site is unchanged; the new /es/blog/[slug] page
  // passes "/es/blog" so its schema URLs point at the real Spanish page,
  // not a fabricated English one.
  basePath?: string;
}

export function articleSchema(post: ArticleSchemaInput) {
  const base = post.basePath ?? "/blog";
  return {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: post.title,
    description: post.description,
    url: `${SITE_URL}${base}/${post.slug}`,
    datePublished: post.datePublished,
    dateModified: post.dateModified ?? post.datePublished,
    mentions: post.mentions?.map((name) => ({ "@type": "Thing", name })),
    image: post.image ? [post.image] : undefined,
    author: { "@id": `${SITE_URL}/#organization` },
    publisher: { "@id": `${SITE_URL}/#organization` },
    mainEntityOfPage: { "@type": "WebPage", "@id": `${SITE_URL}${base}/${post.slug}` },
  };
}

/**
 * NFT collection social/official-link assertion (2026-08-07) — `sameAs`
 * built ONLY from whichever social fields the vendor's own API actually
 * returned for this specific collection (see lib/nft/types.ts's
 * NftCollection doc) — never a padded/guessed array. Renders nothing
 * meaningful (empty sameAs) when a collection has no confirmed social
 * links, which callers should skip rendering entirely rather than emit.
 */
export function nftCollectionBrandSchema(collection: {
  vendor: string;
  slug: string;
  name: string;
  imageUrl?: string;
  externalUrl?: string;
  twitterUsername?: string;
  discordUrl?: string;
  telegramUrl?: string;
}) {
  const sameAs = [
    collection.externalUrl,
    collection.twitterUsername ? `https://x.com/${collection.twitterUsername}` : undefined,
    collection.discordUrl,
    collection.telegramUrl,
  ].filter((v): v is string => Boolean(v));

  return {
    "@context": "https://schema.org",
    "@type": "Brand",
    "@id": `${SITE_URL}/nft/${collection.vendor}/${collection.slug}#brand`,
    name: collection.name,
    ...(collection.imageUrl ? { logo: collection.imageUrl } : {}),
    ...(sameAs.length > 0 ? { sameAs } : {}),
  };
}

export interface HowToSchemaInput {
  slug: string;
  name: string;
  summary: string;
  totalTime?: string; // ISO 8601 duration, e.g. "PT5M"
  tools?: string[];
  /** `id` must match the real rendered heading anchor for that step (see
   * lib/content/headingSlug.ts's slugifyHeading, used by both the custom
   * rehype plugin and the caller building this list) — otherwise `url`
   * below points at an anchor that doesn't actually exist on the page. */
  steps: Array<{ id: string; name: string; text: string }>;
  /** Same purpose as ArticleSchemaInput.basePath — defaults to "/blog". */
  basePath?: string;
}

/**
 * 2026-08-07 (blog tutorial-hub upgrade) — real fields only:
 * `estimatedCost` is this app's actual fee (lib/fees.ts's real 0.25%
 * per-leg figure, not a placeholder string), not every field the schema
 * TYPE allows is populated unconditionally (totalTime/tool are only
 * included when the caller actually has real data for them).
 */
export function howToSchema(input: HowToSchemaInput) {
  const pageUrl = `${SITE_URL}${input.basePath ?? "/blog"}/${input.slug}`;
  return {
    "@context": "https://schema.org",
    "@type": "HowTo",
    "@id": `${pageUrl}#howto`,
    name: input.name,
    description: input.summary,
    estimatedCost: {
      "@type": "MonetaryAmount",
      currency: "USD",
      value: "0.25% platform fee per swap leg, plus network gas",
    },
    ...(input.totalTime ? { totalTime: input.totalTime } : {}),
    ...(input.tools && input.tools.length > 0 ? { tool: input.tools.map((name) => ({ "@type": "HowToTool", name })) } : {}),
    step: input.steps.map((s) => ({
      "@type": "HowToStep",
      url: `${pageUrl}#${s.id}`,
      name: s.name,
      itemListElement: [{ "@type": "HowToDirection", text: s.text }],
    })),
  };
}
