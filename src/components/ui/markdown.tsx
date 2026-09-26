"use client";
import * as React from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { textDir } from "@/lib/bidi";
import { cn } from "@/lib/utils";

interface HastNode {
  type: string;
  value?: string;
  children?: HastNode[];
}

function textOf(node: HastNode | undefined): string {
  if (!node) return "";
  if (node.type === "text") return node.value ?? "";
  return (node.children ?? []).map(textOf).join("");
}

/** Blocks take their direction from their own content, but everything stays right-aligned. */
function block<T extends "p" | "h1" | "h2" | "h3" | "h4" | "blockquote" | "td" | "th">(Tag: T) {
  function Block({ node, ...props }: React.ComponentProps<T> & { node?: HastNode }) {
    return React.createElement(Tag, { ...props, dir: textDir(textOf(node)), style: { textAlign: "right" } });
  }
  return Block;
}

const components: Components = {
  a: ({ node: _node, ...props }) => <a {...props} target="_blank" rel="noreferrer" />,
  p: block("p"),
  h1: block("h1"),
  h2: block("h2"),
  h3: block("h3"),
  h4: block("h4"),
  blockquote: block("blockquote"),
  td: block("td"),
  th: block("th"),
} as Components;

export function Markdown({ children, className }: { children: string; className?: string }) {
  return (
    <div className={cn("md", className)} dir="rtl">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {children}
      </ReactMarkdown>
    </div>
  );
}

/**
 * Plain text (e.g. a prompt someone typed) with line breaks kept: each line gets its own direction
 * so English lines keep their punctuation in place, and all lines stay right-aligned.
 */
export function BidiText({ text, className }: { text: string; className?: string }) {
  return (
    <div className={className} dir="rtl">
      {text.split("\n").map((line, i) =>
        line.trim() ? (
          <p key={i} dir={textDir(line)} className="text-right">
            {line}
          </p>
        ) : (
          <div key={i} className="h-3" />
        ),
      )}
    </div>
  );
}
