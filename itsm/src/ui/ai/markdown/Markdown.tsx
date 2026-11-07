// Safe Markdown for the assistant's answers: GitHub tables, lists, bold, code — never raw HTML, never an image (a
// remote image is a way to leak data), and links only where links.ts allows them (records the tools returned and the
// app's own pages). Persian typography: the text inherits the panel's direction, code is an LTR isolate, table
// figures are tabular.
import { memo, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import "./markdown.css";

export interface MarkdownProps {
  text: string;
  /** a subtle caret after the last word while the answer is being written */
  streaming?: boolean;
  /** the in-app path a link may open, or null to render its text only */
  resolve: (href: string) => string | null;
  /** an in-app path → its full URL (for the href, so a link can open in a new tab) */
  hrefOf: (path: string) => string;
  onNavigate: (path: string) => void;
  className?: string;
}

/** Keeps every URL as written; links.ts decides what becomes a link (react-markdown's default would drop `siraf:`). */
const keep = (url: string) => url;

/** Figures inside table cells line up (tabular); text cells keep their natural width. */
const isFigure = (children: ReactNode) => typeof children === "string" && /^[\s\d۰-۹٬,٫.\-−+٪%()]+$/.test(children) && /[\d۰-۹]/.test(children);

function MarkdownImpl({ text, streaming, resolve, hrefOf, onNavigate, className }: MarkdownProps) {
  const components: Components = {
    a: ({ href, children }) => {
      const path = href ? resolve(href) : null;
      if (!path) return <span className="sa-md-nolink">{children}</span>;
      return (
        <a
          href={hrefOf(path)}
          className="sf-link"
          onClick={(e) => {
            if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
            e.preventDefault();
            onNavigate(path);
          }}
        >
          {children}
        </a>
      );
    },
    // never load an image: show its description, if any, as text
    img: ({ alt }) => (alt ? <span className="sa-md-img">{alt}</span> : null),
    table: ({ children }) => (
      <div className="sa-md-table" tabIndex={0} role="region" aria-label="جدول">
        <table>{children}</table>
      </div>
    ),
    td: ({ children, style }) => (
      <td style={style} className={isFigure(children) ? "sf-num" : undefined}>
        {children}
      </td>
    ),
    pre: ({ children }) => (
      <pre dir="ltr" className="sa-md-pre">
        {children}
      </pre>
    ),
    code: ({ children, className: cls }) => (
      <code dir="ltr" className={cls}>
        {children}
      </code>
    ),
    // headings stay small inside a chat answer
    h1: ({ children }) => <h3 className="sa-md-h">{children}</h3>,
    h2: ({ children }) => <h3 className="sa-md-h">{children}</h3>,
    h3: ({ children }) => <h4 className="sa-md-h sa-md-h4">{children}</h4>,
    h4: ({ children }) => <h4 className="sa-md-h sa-md-h4">{children}</h4>,
    h5: ({ children }) => <h4 className="sa-md-h sa-md-h4">{children}</h4>,
    h6: ({ children }) => <h4 className="sa-md-h sa-md-h4">{children}</h4>,
  };
  return (
    <div className={`sa-md ${streaming ? "is-streaming" : ""} ${className ?? ""}`}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml urlTransform={keep} components={components}>
        {text}
      </ReactMarkdown>
    </div>
  );
}

export const Markdown = memo(MarkdownImpl);
