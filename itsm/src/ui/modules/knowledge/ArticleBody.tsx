// The body of a knowledge article as a help-centre page: GitHub Markdown (tables, task lists, strikethrough) without
// raw HTML; headings carry the anchors of the server's table of contents (`headings()`, same order and slugs) with a
// copy-link button; `> [!NOTE]` … `> [!CAUTION]` are callouts; code blocks are LTR with «رونوشت»; images come only from
// the article's own attachments (`attachment:<id>` — a remote image would tell its server who reads the article);
// links to other articles (`kb:KB000123`) and in-app paths stay in the app, web links open in a new tab.
import { memo, useMemo, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { Button, Tooltip } from "antd";
import { Check, Copy, ImageOff, Info, Lightbulb, Link2, OctagonAlert, ShieldAlert, TriangleAlert } from "lucide-react";
import { useOrg } from "../../lib/org";
import { attachmentUrl } from "../../records";
import { CALLOUTS, KB_LINK, remarkCallouts, remarkSlugs, urlTransform, type CalloutKind } from "./model";

const I14 = { size: 14, strokeWidth: 1.4, absoluteStrokeWidth: true } as const;
const CALLOUT_ICON: Record<CalloutKind, typeof Info> = { note: Info, tip: Lightbulb, important: ShieldAlert, warning: TriangleAlert, caution: OctagonAlert };

const textOf = (children: ReactNode): string =>
  typeof children === "string" ? children : Array.isArray(children) ? children.map(textOf).join("") : children && typeof children === "object" && "props" in (children as object) ? textOf((children as { props: { children?: ReactNode } }).props.children) : "";

function CodeBlock({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLPreElement>(null);
  const [done, setDone] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(ref.current?.innerText ?? "");
      setDone(true);
      setTimeout(() => setDone(false), 1500);
    } catch {
      /* the clipboard is not available (http, permissions): nothing to do */
    }
  };
  return (
    <div className="kb-code">
      <pre ref={ref} dir="ltr">
        {children}
      </pre>
      <Tooltip title={done ? "رونوشت شد" : "رونوشت"}>
        <Button className="kb-code-copy" size="small" type="text" icon={done ? <Check {...I14} /> : <Copy {...I14} />} onClick={copy} aria-label="رونوشت دستور" />
      </Tooltip>
    </div>
  );
}

function HeadingAnchor({ id }: { id?: string }) {
  if (!id) return null;
  const copy = () => {
    const url = `${window.location.origin}${window.location.pathname}#${id}`;
    void navigator.clipboard?.writeText(url).catch(() => undefined);
    history.replaceState(null, "", `#${id}`);
  };
  return (
    <a href={`#${id}`} className="kb-anchor" aria-label="پیوند این بخش" onClick={(e) => (e.preventDefault(), copy())}>
      <Link2 {...I14} />
    </a>
  );
}

export interface ArticleBodyProps {
  text: string;
  /** a draft's preview: images of attachments still load, links do not navigate away from the editor */
  preview?: boolean;
  className?: string;
}

/** The components of the reading view (stable per organisation and mode, so headings are not remounted). */
function makeComponents(orgId: string, preview: boolean): Components {
  const heading = (Tag: "h2" | "h3" | "h4") =>
    function H({ children, id }: { children?: ReactNode; id?: string }) {
      return (
        <Tag id={id}>
          {children}
          {preview ? null : <HeadingAnchor id={id} />}
        </Tag>
      );
    };
  return {
    h1: heading("h2"),
    h2: heading("h2"),
    h3: heading("h3"),
    h4: heading("h4"),
    h5: ({ children }) => <p className="font-medium">{children}</p>,
    h6: ({ children }) => <p className="font-medium">{children}</p>,
    a: ({ href, children }) => {
      const h = String(href ?? "");
      const kb = KB_LINK.exec(h);
      if (kb) return preview ? <span className="ds-link">{children}</span> : <Link to={`/${orgId}/kb/n/${kb[1].toUpperCase().replace("-", "")}`}>{children}</Link>;
      if (h.startsWith("#")) return <a href={h}>{children}</a>;
      if (h.startsWith(`/${orgId}/`)) return preview ? <span className="ds-link">{children}</span> : <Link to={h}>{children}</Link>;
      if (/^(https?:|mailto:)/i.test(h))
        return (
          <a href={h} target="_blank" rel="noopener noreferrer nofollow">
            {children}
          </a>
        );
      return <span>{children}</span>;
    },
    img: ({ src, alt }) => {
      const m = /^attachment:([0-9a-f-]{36})$/i.exec(String(src ?? ""));
      if (!m)
        return (
          <span className="kb-img-missing">
            <ImageOff {...I14} /> تصویر بیرونی نمایش داده نمی‌شود{alt ? `: ${alt}` : ""}
          </span>
        );
      return (
        <span className="kb-figure block" role="figure" aria-label={alt || undefined}>
          <img src={attachmentUrl(orgId, m[1].toLowerCase(), true)} alt={alt ?? ""} loading="lazy" />
          {alt ? <span className="mt-1.5 block text-[12px] text-ink-3">{alt}</span> : null}
        </span>
      );
    },
    pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
    code: ({ children, className: cls }) => (
      <code dir="ltr" className={cls}>
        {children}
      </code>
    ),
    table: ({ children }) => (
      <div className="kb-table" tabIndex={0} role="region" aria-label="جدول">
        <table>{children}</table>
      </div>
    ),
    aside: ({ children, ...props }) => {
      const kind = ((props as Record<string, unknown>)["data-kind"] as CalloutKind) ?? "note";
      const Icon = CALLOUT_ICON[kind] ?? Info;
      return (
        <aside className={`kb-callout is-${CALLOUTS[kind]?.tone ?? "info"}`} role="note">
          <span className="kb-callout-title">
            <Icon {...I14} />
            {CALLOUTS[kind]?.label ?? "یادداشت"}
          </span>
          {children}
        </aside>
      );
    },
  };
}

function ArticleBodyImpl({ text, preview, className }: ArticleBodyProps) {
  const { orgId } = useOrg();
  const components = useMemo(() => makeComponents(orgId, !!preview), [orgId, preview]);
  return (
    <div className={`kb-prose ${className ?? ""}`}>
      <ReactMarkdown remarkPlugins={[remarkGfm, remarkSlugs(text), remarkCallouts]} skipHtml urlTransform={urlTransform} components={components}>
        {text}
      </ReactMarkdown>
    </div>
  );
}

export const ArticleBody = memo(ArticleBodyImpl);

/** The plain text of a heading's children (for tests and the table of contents). */
export { textOf };
