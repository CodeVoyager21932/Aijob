import { Link, Text } from "@aijob/resume-forme/primitives";
import { HTMLElement, type Node as HtmlNode, parse } from "node-html-parser";
import type { ReactNode } from "react";

function inline(node: HtmlNode, key: number): ReactNode {
  if (!(node instanceof HTMLElement)) return node.textContent.replace(/[\t\r\n ]+/g, " ");
  const tag = node.tagName.toLowerCase();
  if (tag === "br") return "\n";
  const children = node.childNodes.map(inline);
  if (tag === "a") {
    const href = node.getAttribute("href") || "";
    return /^(https?:\/\/|mailto:|tel:)/i.test(href) ? (
      <Link key={key} src={href} style={{ textDecoration: "underline" }}>
        {children}
      </Link>
    ) : (
      children
    );
  }
  const style =
    tag === "strong" || tag === "b"
      ? { fontWeight: 700 }
      : tag === "u"
        ? { textDecoration: "underline" as const }
        : {};
  return (
    <Text key={key} style={style}>
      {children}
    </Text>
  );
}
export function richBlocks(html: string): ReactNode[][] {
  const blocks: ReactNode[][] = [];
  const visit = (nodes: HtmlNode[], depth = 0, orderedStart?: number) => {
    let ordinal = orderedStart;
    let run: HtmlNode[] = [];
    const flush = () => {
      if (run.some((n) => n.textContent.trim())) blocks.push(run.map(inline));
      run = [];
    };
    for (const node of nodes) {
      const tag = node instanceof HTMLElement ? node.tagName.toLowerCase() : "";
      if (["p", "div", "blockquote", "ul", "ol", "li"].includes(tag)) {
        flush();
        if (tag === "li") {
          const child = node.childNodes.filter(
            (n) => !(n instanceof HTMLElement) || !["UL", "OL"].includes(n.tagName),
          );
          if (child.some((n) => n.textContent.trim()))
            blocks.push([
              `${"  ".repeat(depth)}${ordinal === undefined ? "•" : `${ordinal++}.`} `,
              ...child.map(inline),
            ]);
          const lists = node.childNodes.filter(
            (n) => n instanceof HTMLElement && ["UL", "OL"].includes(n.tagName),
          );
          visit(lists, depth + 1);
        } else
          visit(
            node.childNodes,
            depth,
            tag === "ol" ? Number((node as HTMLElement).getAttribute("start")) || 1 : undefined,
          );
      } else run.push(node);
    }
    flush();
  };
  visit(parse(html).childNodes);
  return blocks;
}
