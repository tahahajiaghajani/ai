import type { L } from "@/lib/i18n";

export type { L };

/** A picture, a video, or a generative artwork drawn in code. */
export type Media =
  | {
      kind: "image";
      src: string;
      alt: L;
      w: number;
      h: number;
      caption?: L;
      /** how the picture is framed: a browser window, a phone, or bare */
      frame?: "browser" | "phone" | "none";
      /** screenshots keep their colours; photographs and art go monochrome until hovered */
      tone?: "mono" | "color";
      /** gallery width in twelfths on wide screens (default: 4 for tall pictures, 12 otherwise) */
      span?: Span;
      /** a tiny base64 preview shown blurred while the picture loads */
      blur?: string;
      /** where the picture is anchored when it is cropped to fill a box (CSS object-position) */
      focus?: string;
    }
  | { kind: "video"; src: string; poster: string; alt: L; w: number; h: number; caption?: L; span?: Span }
  | { kind: "art"; art: ArtKind; alt: L; caption?: L };

export type Span = 3 | 4 | 5 | 6 | 7 | 8 | 12;

export type ImageMedia = Extract<Media, { kind: "image" }>;

/** Generative covers drawn on canvas/SVG, one per kind of system. */
export type ArtKind = "graph" | "vision" | "signal" | "flow" | "orbit" | "grid" | "type" | "mesh" | "wave";

export type NodeKind = "source" | "process" | "model" | "store" | "output" | "human" | "agent";

/** A system diagram laid out on a small grid (col/row from the reading start, top-left in LTR). */
export interface Diagram {
  cols: number;
  rows: number;
  nodes: { id: string; label: L; sub?: L; col: number; row: number; kind: NodeKind; span?: number }[];
  edges: { from: string; to: string; label?: L; dashed?: boolean }[];
  caption?: L;
}

export interface CodeSample {
  title: L;
  lang: string;
  file: string;
  code: string;
}

export interface Outcome {
  value: L;
  label: L;
}

export type Discipline = "enterprise-ai" | "agents" | "rag" | "vision" | "industrial" | "fullstack" | "data" | "design" | "motion" | "automation" | "3d";

export interface Project {
  slug: string;
  title: L;
  /** short category line, e.g. "Enterprise AI · Banking" */
  kicker: L;
  oneLiner: L;
  year: string;
  period: L;
  role: L;
  context: L;
  status: L;
  disciplines: Discipline[];
  stack: string[];
  cover: Media;
  /** paragraphs separated by blank lines */
  challenge: L;
  approach: L;
  architecture?: Diagram;
  features: L<string[]>;
  outcomes: Outcome[];
  gallery: Media[];
  code?: CodeSample[];
  links?: { label: L; href: string }[];
  orgs?: string[];
  /** shown under the facts when details are withheld (client confidentiality) */
  note?: L;
  /** a bespoke interactive piece shown after the architecture */
  interactive?: "hole-inspector" | "dag-player" | "audit-centre";
  /** featured projects lead the home rail; the rest sit in the index */
  featured?: boolean;
  /** "lab" = research and plans, kept apart from shipped work */
  tier?: "flagship" | "work" | "lab";
}

export interface Org {
  key: string;
  name: L;
  /** monochrome logo; rendered white on black (CSS) */
  logo?: string;
  url?: string;
  relation: L;
}

export interface Role {
  org: string;
  title: L;
  period: L;
  body: L;
  current?: boolean;
}

/** How a product reaches people: the web version is open to everyone; the others are given on request. */
export type EditionKind = "web" | "windows" | "server";

export interface Edition {
  kind: EditionKind;
  /** the live address; an edition without one is locked (visitors contact Taha to use it) */
  href?: string;
  /** one line on where and how it runs */
  note: L;
}

/** A product of Taha's own, promoted on the home page in a section of its own. */
export interface Product {
  /** also the id of its home-page section */
  slug: string;
  name: L;
  /** the eyebrow: what kind of product it is */
  category: L;
  /** the product's own line */
  tagline: L;
  summary: L;
  features: L<string[]>;
  editions: Edition[];
  /** screenshots: the first leads, a second one sits over its corner */
  shots: Media[];
  stack: string[];
  status: L;
  period: L;
  role: L;
  /** authorship and honesty notes */
  note?: L;
  /** extra retrieval words for the assistant (both languages) */
  tags: string[];
}

/** One block of a blog post's body. */
export type PostBlock =
  | { kind: "text"; heading?: L; text: L }
  | { kind: "list"; heading?: L; items: L<string[]> }
  | { kind: "figure"; media: Media }
  | { kind: "gallery"; items: Media[] }
  | { kind: "quote"; text: L; cite?: L };

export interface Post {
  slug: string;
  /** publication date (ISO, Tehran) */
  date: string;
  title: L;
  /** the standfirst under the title */
  dek: L;
  kicker: L;
  cover: Media;
  /** the share image (1200×630) */
  og: string;
  /** facts shown beside the cover */
  facts: { k: L; v: L }[];
  blocks: PostBlock[];
  /** retrieval words for the assistant (both languages) */
  tags: string[];
  /** case studies to read next */
  related?: string[];
  sources?: { label: L; href: string }[];
  note?: L;
}
