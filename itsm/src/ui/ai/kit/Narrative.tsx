// A model-written narrative as safe Markdown: GFM tables and lists, no raw HTML, no images, and links only inside the
// app (a path like "/reports/ledger?account=…" opens in this organisation; anything else stays plain text).
import "./ai.css";
import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { Link } from "react-router";
import { useOrg } from "../../lib/org";

/** In-app link targets only: a relative app path, never a scheme, a host or a protocol-relative URL. */
export function appPath(href: string | undefined | null): string | null {
  if (!href) return null;
  const h = href.trim();
  if (!h.startsWith("/") || h.startsWith("//") || /[\s\\]/.test(h)) return null;
  return h.replace(/^\/+/, "");
}

export function Narrative({ text, className }: { text: string; className?: string }) {
  const { orgId } = useOrg();
  const components: Components = {
    a: ({ href, children }) => {
      const p = appPath(href);
      return p ? <Link to={`/${orgId}/${p}`}>{children}</Link> : <>{children}</>;
    },
    table: ({ children }) => (
      <div className="ai-md-wrap">
        <table>{children}</table>
      </div>
    ),
  };
  return (
    <div className={`ai-md ${className ?? ""}`} dir="rtl">
      <Markdown remarkPlugins={[remarkGfm]} skipHtml disallowedElements={["img"]} unwrapDisallowed components={components}>
        {text}
      </Markdown>
    </div>
  );
}
