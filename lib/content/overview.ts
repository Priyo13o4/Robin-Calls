/**
 * Parser for the project overview master document (`content/investor-overview.md`).
 *
 * This is the single source both surfaces render from: `app/overview/page.tsx`
 * turns the AST into the web page, `scripts/build-overview.ts` turns the same
 * AST into the branded PDF. The document's feature set is deliberately tiny
 * (headings, paragraphs, bullets, ordered lists, pipe tables, blockquote notes,
 * bold/italic) so one parser can serve both emitters with no markdown
 * dependency.
 *
 * Failure policy is CLAUDE.md §4/§8: an unrecognized line THROWS with its line
 * number. A syntax this parser does not know must stop the build, because the
 * alternative is an emitter silently dropping content the other emitter
 * renders — two surfaces disagreeing about the same "single source".
 */

export interface OverviewFrontmatter {
  title: string;
  subtitle: string;
  tagline: string;
  strapline: string;
  version: string;
  date: string;
}

/** A span of text with optional emphasis. No links, by document policy. */
export interface InlineRun {
  text: string;
  bold?: boolean;
  italic?: boolean;
}

export type Block =
  | { kind: "p"; runs: InlineRun[] }
  | { kind: "ul"; items: InlineRun[][] }
  | { kind: "ol"; items: InlineRun[][] }
  /** Blockquote (`>`) — used by the document for as-of/status notes. */
  | { kind: "note"; runs: InlineRun[] }
  | { kind: "table"; header: string[]; rows: string[][] };

export interface OverviewSubsection {
  id: string;
  title: string;
  /** 3 = `###`, 4 = `####`. */
  level: 3 | 4;
  blocks: Block[];
}

export interface OverviewSection {
  id: string;
  title: string;
  /**
   * Sequential document-order number, or null for the two unnumbered kinds
   * (the Important Notice and Appendix headings) — matching the printed
   * document, where numbering starts at Executive Summary.
   */
  number: number | null;
  /** Blocks before the first subsection. */
  blocks: Block[];
  subsections: OverviewSubsection[];
}

export interface OverviewPart {
  id: string;
  /** Roman numeral, assigned in document order. */
  numeral: string;
  title: string;
  sections: OverviewSection[];
}

export interface OverviewDoc {
  meta: OverviewFrontmatter;
  parts: OverviewPart[];
}

const REQUIRED_META = ["title", "subtitle", "tagline", "strapline", "version", "date"] as const;

const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"];

/** Headings that never take a section number, matching the printed document. */
const UNNUMBERED = new Set(["Important Notice"]);
const UNNUMBERED_PREFIX = "Appendix";

export function slugifyHeading(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/&/g, " ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!slug) throw new Error(`overview.md: heading "${title}" produces an empty anchor id`);
  return slug;
}

/** Parse `**bold**` and `*italic*` spans. Everything else is literal text. */
export function parseInline(raw: string): InlineRun[] {
  const runs: InlineRun[] = [];
  // Scanner walks the string; ** is matched before * so bold wins on `**x**`.
  let i = 0;
  let plain = "";
  const flush = () => {
    if (plain) {
      runs.push({ text: plain });
      plain = "";
    }
  };
  while (i < raw.length) {
    if (raw.startsWith("**", i)) {
      const end = raw.indexOf("**", i + 2);
      if (end === -1) {
        plain += raw[i];
        i += 1;
        continue;
      }
      flush();
      runs.push({ text: raw.slice(i + 2, end), bold: true });
      i = end + 2;
    } else if (raw[i] === "*") {
      const end = raw.indexOf("*", i + 1);
      if (end === -1 || end === i + 1) {
        plain += raw[i];
        i += 1;
        continue;
      }
      flush();
      runs.push({ text: raw.slice(i + 1, end), italic: true });
      i = end + 1;
    } else {
      plain += raw[i];
      i += 1;
    }
  }
  flush();
  return runs;
}

function splitRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim());
}

const SEPARATOR_ROW = /^\|(\s*:?-{2,}:?\s*\|)+$/;

export function parseOverviewDocument(markdown: string): OverviewDoc {
  const lines = markdown.split("\n");

  // ---- front-matter ----
  if (lines[0]?.trim() !== "---") {
    throw new Error("overview.md: file must start with a --- front-matter block");
  }
  let idx = 1;
  const meta = {} as Record<string, string>;
  for (; idx < lines.length; idx += 1) {
    const line = lines[idx];
    if (line.trim() === "---") {
      idx += 1;
      break;
    }
    const m = line.match(/^([a-zA-Z]+):\s*(.*)$/);
    if (!m) throw new Error(`overview.md:${idx + 1}: expected "key: value" in front-matter, got "${line}"`);
    meta[m[1]] = m[2].trim();
  }
  for (const key of REQUIRED_META) {
    if (!meta[key]) throw new Error(`overview.md: front-matter is missing required key "${key}"`);
  }

  const doc: OverviewDoc = {
    meta: meta as unknown as OverviewFrontmatter,
    parts: [],
  };
  let part: OverviewPart | null = null;
  let section: OverviewSection | null = null;
  let subsection: OverviewSubsection | null = null;
  let sectionCounter = 0;
  const seenIds = new Set<string>();

  const uniqueId = (title: string): string => {
    const base = slugifyHeading(title);
    let id = base;
    let n = 2;
    while (seenIds.has(id)) {
      id = `${base}-${n}`;
      n += 1;
    }
    seenIds.add(id);
    return id;
  };

  const pushBlock = (block: Block) => {
    const target = subsection ?? section;
    if (!target) {
      throw new Error(`overview.md: block before any ## section heading — content would be dropped`);
    }
    target.blocks.push(block);
  };

  const flushList = (list: { kind: "ul" | "ol"; items: InlineRun[][] } | null) => {
    if (list) pushBlock(list);
    return null;
  };

  let list: { kind: "ul" | "ol"; items: InlineRun[][] } | null = null;

  for (; idx < lines.length; idx += 1) {
    const raw = lines[idx];
    const line = raw.trim();
    const lineNo = idx + 1;

    if (line === "") {
      list = flushList(list);
      continue;
    }

    if (line.startsWith("#### ")) {
      list = flushList(list);
      if (!section) throw new Error(`overview.md:${lineNo}: #### before any ## section`);
      subsection = {
        id: uniqueId(line.slice(5)),
        title: line.slice(5),
        level: 4,
        blocks: [],
      };
      section.subsections.push(subsection);
      continue;
    }

    if (line.startsWith("### ")) {
      list = flushList(list);
      if (!section) throw new Error(`overview.md:${lineNo}: ### before any ## section`);
      subsection = {
        id: uniqueId(line.slice(4)),
        title: line.slice(4),
        level: 3,
        blocks: [],
      };
      section.subsections.push(subsection);
      continue;
    }

    if (line.startsWith("## ")) {
      list = flushList(list);
      const title = line.slice(3);
      if (!part) throw new Error(`overview.md:${lineNo}: ## section before any # part heading`);
      const numbered = !UNNUMBERED.has(title) && !title.startsWith(UNNUMBERED_PREFIX);
      // Unnumbered sections (Notice, Appendices) do not consume a number —
      // the printed document's "1" is Executive Summary.
      if (numbered) sectionCounter += 1;
      section = {
        id: uniqueId(title),
        title,
        number: numbered ? sectionCounter : null,
        blocks: [],
        subsections: [],
      };
      part.sections.push(section);
      subsection = null;
      continue;
    }

    if (line.startsWith("# ")) {
      list = flushList(list);
      const title = line.slice(2);
      part = {
        id: uniqueId(`part-${title}`),
        numeral: ROMAN[doc.parts.length],
        title,
        sections: [],
      };
      if (!part.numeral) throw new Error(`overview.md:${lineNo}: more than ${ROMAN.length} parts`);
      doc.parts.push(part);
      section = null;
      subsection = null;
      continue;
    }

    if (line.startsWith("> ")) {
      list = flushList(list);
      // A note attaches to the subsection it sits under (the as-of lines
      // follow their tables) — it must not fall back up to the section, or it
      // renders above the subsection heading it belongs below.
      pushBlock({ kind: "note", runs: parseInline(line.slice(2)) });
      continue;
    }

    if (line.startsWith("| ")) {
      list = flushList(list);
      const rows: string[][] = [];
      let header: string[] | null = null;
      let cursor = idx;
      while (cursor < lines.length && lines[cursor].trim().startsWith("|")) {
        const rowLine = lines[cursor].trim();
        if (!header) {
          header = splitRow(rowLine);
        } else if (!SEPARATOR_ROW.test(rowLine)) {
          const cells = splitRow(rowLine);
          if (cells.length !== header.length) {
            throw new Error(
              `overview.md:${cursor + 1}: table row has ${cells.length} cells, header has ${header.length}`
            );
          }
          rows.push(cells);
        }
        cursor += 1;
      }
      if (!header) throw new Error(`overview.md:${lineNo}: empty table`);
      pushBlock({ kind: "table", header, rows });
      idx = cursor - 1;
      continue;
    }

    const olMatch = line.match(/^(\d+)\.\s+(.*)$/);
    if (olMatch) {
      if (!list || list.kind !== "ol") {
        list = flushList(list);
        list = { kind: "ol", items: [] };
      }
      list.items.push(parseInline(olMatch[2]));
      continue;
    }

    if (line.startsWith("- ")) {
      if (!list || list.kind !== "ul") {
        list = flushList(list);
        list = { kind: "ul", items: [] };
      }
      list.items.push(parseInline(line.slice(2)));
      continue;
    }

    // Anything starting with a known-but-unsupported marker fails loudly
    // rather than rendering as mystery literal text.
    if (/^(\*\s|```|\+\s)/.test(line)) {
      throw new Error(`overview.md:${lineNo}: unsupported syntax: "${line.slice(0, 40)}"`);
    }

    list = flushList(list);
    pushBlock({ kind: "p", runs: parseInline(line) });
  }
  flushList(list);

  if (doc.parts.length === 0) throw new Error("overview.md: no # part headings found");

  return doc;
}

/** Flat [partId, sectionId…] anchor list in reading order — what the scroll-spy walks. */
export function overviewAnchors(doc: OverviewDoc): string[] {
  return doc.parts.flatMap((p) => [p.id, ...p.sections.map((s) => s.id)]);
}
