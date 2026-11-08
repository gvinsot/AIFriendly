"use client";

import React from "react";

/**
 * Rendu Markdown minimal et SÛR (sans dépendance, sans `dangerouslySetInnerHTML`).
 *
 * Utilisé pour afficher le rapport de l'agent de pentest, rédigé en Markdown.
 * Le contenu provient d'un LLM : on ne génère que des éléments React (jamais de
 * HTML brut), ce qui élimine tout risque d'injection. On couvre le sous-ensemble
 * courant : titres, listes à puces/numérotées, gras, italique, code (inline et
 * bloc), citations, liens (http/https/mailto uniquement) et paragraphes.
 */

// ─── Inline ──────────────────────────────────────────────────────────────────

const INLINE_RE =
  /(`[^`]+`)|(\*\*[^*]+\*\*)|(__[^_]+__)|(\*[^*\n]+\*)|(_[^_\n]+_)|(\[[^\]]+\]\([^)]+\))/;

function safeHref(url: string): string | null {
  const trimmed = url.trim();
  if (/^(https?:\/\/|mailto:)/i.test(trimmed)) return trimmed;
  return null;
}

function renderInline(text: string, keyPrefix: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  let remaining = text;
  let i = 0;

  while (remaining.length > 0) {
    const m = remaining.match(INLINE_RE);
    if (!m || m.index === undefined) {
      nodes.push(remaining);
      break;
    }
    if (m.index > 0) nodes.push(remaining.slice(0, m.index));
    const token = m[0];
    const key = `${keyPrefix}-${i++}`;

    if (token.startsWith("`")) {
      nodes.push(
        <code key={key} className="rounded bg-luxe-bg-muted px-1 py-0.5 text-[0.85em] font-mono text-luxe-gold">
          {token.slice(1, -1)}
        </code>,
      );
    } else if (token.startsWith("**") || token.startsWith("__")) {
      nodes.push(
        <strong key={key} className="font-semibold text-luxe-fg">
          {token.slice(2, -2)}
        </strong>,
      );
    } else if (token.startsWith("[")) {
      const linkMatch = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      const href = linkMatch ? safeHref(linkMatch[2]) : null;
      if (linkMatch && href) {
        nodes.push(
          <a key={key} href={href} target="_blank" rel="noopener noreferrer" className="text-luxe-gold underline hover:text-luxe-gold/80">
            {linkMatch[1]}
          </a>,
        );
      } else {
        nodes.push(token);
      }
    } else {
      // italique *…* ou _…_
      nodes.push(
        <em key={key} className="italic">
          {token.slice(1, -1)}
        </em>,
      );
    }
    remaining = remaining.slice(m.index + token.length);
  }

  return nodes;
}

// ─── Blocs ───────────────────────────────────────────────────────────────────

const HEADING_CLASSES: Record<number, string> = {
  1: "text-base font-semibold text-luxe-fg mt-4 mb-2 first:mt-0",
  2: "text-sm font-semibold text-luxe-fg mt-4 mb-2 first:mt-0",
  3: "text-sm font-semibold text-luxe-fg mt-3 mb-1.5 first:mt-0",
  4: "text-xs font-semibold text-luxe-fg uppercase tracking-wide mt-3 mb-1.5 first:mt-0",
  5: "text-xs font-semibold text-luxe-fg-muted mt-2 mb-1 first:mt-0",
  6: "text-xs font-semibold text-luxe-fg-muted mt-2 mb-1 first:mt-0",
};

export function Markdown({ content, className = "" }: { content: string; className?: string }) {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const blocks: React.ReactNode[] = [];
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Bloc de code ``` … ```
    const fence = line.match(/^\s*```(.*)$/);
    if (fence) {
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !/^\s*```/.test(lines[i])) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // saute la clôture
      blocks.push(
        <pre key={key++} className="my-2 overflow-auto rounded-lg border border-luxe-border bg-luxe-bg p-3 text-xs font-mono text-luxe-fg-muted">
          <code>{codeLines.join("\n")}</code>
        </pre>,
      );
      continue;
    }

    // Ligne vide → séparateur
    if (line.trim() === "") {
      i++;
      continue;
    }

    // Titre
    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      const level = heading[1].length;
      const Tag = `h${level}` as keyof React.JSX.IntrinsicElements;
      blocks.push(
        <Tag key={key++} className={HEADING_CLASSES[level]}>
          {renderInline(heading[2], `h${key}`)}
        </Tag>,
      );
      i++;
      continue;
    }

    // Citation
    if (/^\s*>\s?/.test(line)) {
      const quoteLines: string[] = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
        quoteLines.push(lines[i].replace(/^\s*>\s?/, ""));
        i++;
      }
      blocks.push(
        <blockquote key={key++} className="my-2 border-l-2 border-luxe-gold/40 pl-3 text-luxe-fg-muted italic">
          {renderInline(quoteLines.join(" "), `q${key}`)}
        </blockquote>,
      );
      continue;
    }

    // Liste à puces
    if (/^\s*[-*+]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*+]\s+/, ""));
        i++;
      }
      blocks.push(
        <ul key={key++} className="my-2 list-disc space-y-1 pl-5">
          {items.map((it, idx) => (
            <li key={idx}>{renderInline(it, `ul${key}-${idx}`)}</li>
          ))}
        </ul>,
      );
      continue;
    }

    // Liste numérotée
    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+[.)]\s+/, ""));
        i++;
      }
      blocks.push(
        <ol key={key++} className="my-2 list-decimal space-y-1 pl-5">
          {items.map((it, idx) => (
            <li key={idx}>{renderInline(it, `ol${key}-${idx}`)}</li>
          ))}
        </ol>,
      );
      continue;
    }

    // Paragraphe : lignes consécutives non vides et non structurelles
    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !/^\s*```/.test(lines[i]) &&
      !/^(#{1,6})\s+/.test(lines[i]) &&
      !/^\s*[-*+]\s+/.test(lines[i]) &&
      !/^\s*\d+[.)]\s+/.test(lines[i]) &&
      !/^\s*>\s?/.test(lines[i])
    ) {
      para.push(lines[i]);
      i++;
    }
    blocks.push(
      <p key={key++} className="my-2 leading-relaxed first:mt-0 last:mb-0">
        {renderInline(para.join(" "), `p${key}`)}
      </p>,
    );
  }

  return <div className={className}>{blocks}</div>;
}
