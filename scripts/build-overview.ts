/**
 * Builds the branded PDF from the markdown master.
 *
 *   npx tsx scripts/build-overview.ts
 *
 * Reads `content/investor-overview.md`, parses it with the SAME parser the
 * /overview page uses (lib/content/overview.ts), and emits LaTeX carrying the
 * approved print design (noir cover, lime header band, Avenir Next). The PDF is
 * copied to `public/downloads/robincalls-overview.pdf` so it deploys with the
 * site, and a sha256 of the MASTER (not the PDF) is written beside it —
 * `tests/overview-content.test.ts` compares that hash against the live md so an
 * edit without a rebuild cannot ship silently.
 *
 * macOS-only by necessity: the design is typeset in Avenir Next, a Mac system
 * font. CI cannot build this PDF, which is why the artifact is committed.
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseOverviewDocument, type Block, type InlineRun, type OverviewDoc } from "../lib/content/overview";

/**
 * Repo root. Primary answer is process.cwd() (the documented invocation runs
 * from the repo root); the import.meta derivation is the fallback for when the
 * script is bundled elsewhere — bundling rewrites import.meta.url to the
 * bundle's own path, so there it points at the wrong tree.
 */
function repoRoot(): string {
  const fromCwd = process.cwd();
  if (existsSync(join(fromCwd, "content", "investor-overview.md"))) return fromCwd;
  return join(dirname(fileURLToPath(import.meta.url)), "..");
}

const ROOT = repoRoot();
const MD_PATH = join(ROOT, "content", "investor-overview.md");
const SCRATCH = join(ROOT, "docs", "investor-overview");
const OUT_DIR = join(ROOT, "public", "downloads");
const TEX_NAME = "main.tex";

/* ── LaTeX escaping ──────────────────────────────────────────────────────── */

function escapeLatex(text: string): string {
  return text
    .replace(/\\/g, "\\textbackslash{}")
    .replace(/([&%$#_{}])/g, "\\$1")
    .replace(/~/g, "\\textasciitilde{}")
    .replace(/\^/g, "\\textasciicircum{}")
    // LAST: the mapping itself introduces a backslash, so it must run after
    // the backslash escape or the arrow it emits gets escaped too.
    .replace(/→/g, "$\\rightarrow$");
}

function inlineToTex(runs: InlineRun[]): string {
  return runs
    .map((r) => {
      const t = escapeLatex(r.text);
      if (r.bold && r.italic) return `\\textbf{\\textit{${t}}}`;
      if (r.bold) return `\\textbf{${t}}`;
      if (r.italic) return `\\textit{${t}}`;
      return t;
    })
    .join("");
}

/* ── block emitters ──────────────────────────────────────────────────────── */

function blocksToTex(blocks: Block[]): string {
  const out: string[] = [];
  for (const b of blocks) {
    switch (b.kind) {
      case "p":
        out.push(inlineToTex(b.runs), "");
        break;
      case "ul":
        out.push(
          "\\begin{itemize}[leftmargin=1.5em,itemsep=2pt,topsep=2pt,label={\\color{limehot}\\fontsize{7}{7}\\selectfont$\\blacksquare$}]",
          ...b.items.map((item) => `\\item ${inlineToTex(item)}`),
          "\\end{itemize}",
          ""
        );
        break;
      case "ol":
        out.push(
          "\\begin{enumerate}[leftmargin=1.6em,itemsep=2pt,topsep=2pt]",
          ...b.items.map((item) => `\\item ${inlineToTex(item)}`),
          "\\end{enumerate}",
          ""
        );
        break;
      case "note":
        out.push(`\\asof{${inlineToTex(b.runs)}}`, "");
        break;
      case "table":
        out.push(tableToTex(b.header, b.rows));
        break;
    }
  }
  return out.join("\n");
}

/** Proportional column widths (fractions of \textwidth) per column count. */
const COLUMN_FRACTIONS: Record<number, number[]> = {
  2: [0.42, 0.58],
  3: [0.26, 0.42, 0.32],
  4: [0.2, 0.3, 0.28, 0.22],
};

function tableToTex(header: string[], rows: string[][]): string {
  const fractions = COLUMN_FRACTIONS[header.length];
  if (!fractions) {
    throw new Error(`build-overview: no column-width plan for a ${header.length}-column table`);
  }
  const widths = fractions.map((f) => (f * 16.0).toFixed(2) + "cm");
  const colSpec = widths.map((w) => `L{${w}}`).join(" ");
  const headRow = header.map((h) => `\\thead ${escapeLatex(h)}`).join(" & ");
  const bodyRows = rows
    .map((row) => row.map((cell) => `\\tcell ${escapeLatex(cell)}`).join(" & ") + " \\\\")
    .join("\n");
  return [
    "{\\renewcommand{\\arraystretch}{1.5}",
    `\\begin{longtable}{${colSpec}}`,
    `\\rowcolor{limehead}${headRow} \\\\`,
    "\\endhead",
    bodyRows,
    "\\end{longtable}}",
    "",
  ].join("\n");
}

/* ── document assembly ───────────────────────────────────────────────────── */

function partDivider(numeral: string, title: string): string {
  return [
    "\\vspace{20pt}",
    "{\\color{limehot}\\rule{\\textwidth}{1.6pt}}\\\\[12pt]",
    `\\noindent{\\color{muted}\\fontsize{8.5}{9}\\selectfont\\bfseries\\addfontfeatures{LetterSpace=5}PART ${numeral}}\\\\[5pt]`,
    `\\noindent{\\color{noir}\\condensed\\fontsize{19}{23}\\selectfont\\bfseries\\addfontfeatures{LetterSpace=3}${escapeLatex(title.toUpperCase())}}\\\\[6pt]`,
    "",
  ].join("\n");
}

function documentBody(doc: OverviewDoc): string {
  const out: string[] = [];

  // Contents, generated from the same AST — it cannot drift from the body.
  out.push("\\section*{Contents}", "\\vspace{-6pt}");
  out.push("{\\setlength{\\columnsep}{26pt}\\begin{multicols}{2}\\small");
  out.push("\\begin{itemize}[leftmargin=1.35em,itemsep=1.5pt,topsep=2pt,label={\\color{limehot}\\fontsize{7}{7}\\selectfont$\\blacksquare$}]");
  for (const part of doc.parts) {
    out.push(`\\item \\textbf{${escapeLatex(part.numeral)}. ${escapeLatex(part.title)}}`);
    for (const s of part.sections) {
      const num = s.number !== null ? `${s.number} \\;` : "";
      out.push(`\\item ${num}${escapeLatex(s.title)}`);
    }
  }
  out.push("\\end{itemize}\\end{multicols}}", "");

  for (const part of doc.parts) {
    out.push(partDivider(part.numeral, part.title));
    for (const section of part.sections) {
      // Numbered sections use \section so LaTeX's own counter produces the
      // number; unnumbered (Notice, Appendices) use \section*. The AST's
      // `number` and the LaTeX counter agree by construction — both count the
      // same sequence.
      if (section.number !== null) {
        out.push(`\\section{${escapeLatex(section.title)}}`, "");
      } else {
        out.push(`\\section*{${escapeLatex(section.title)}}`, "");
      }
      out.push(blocksToTex(section.blocks));
      for (const sub of section.subsections) {
        if (sub.level === 3) out.push(`\\subsection{${escapeLatex(sub.title)}}`, "");
        else out.push(`\\subsubsection{${escapeLatex(sub.title)}}`, "");
        out.push(blocksToTex(sub.blocks));
      }
    }
  }

  // Closing block.
  out.push(
    "\\vspace{14pt}",
    "\\begin{center}",
    `\\asof{${escapeLatex(`${doc.meta.title} ${doc.meta.subtitle} · Version ${doc.meta.version}, ${doc.meta.date}`)}}`,
    "\\end{center}",
    ""
  );
  return out.join("\n");
}

/* ── main ────────────────────────────────────────────────────────────────── */

function main() {
  const md = readFileSync(MD_PATH, "utf8");
  const doc = parseOverviewDocument(md);

  // Scratch dir keeps the generated tex/pdf and the downscaled logo. The logo
  // is reused when present: `sips` writes its own temp file into the SYSTEM
  // temp dir, which locked-down environments (sandboxes) may deny — regenerating
  // a 418px PNG on every build buys nothing anyway.
  mkdirSync(SCRATCH, { recursive: true });
  for (const f of ["main.tex", "main.pdf", "main.aux", "main.log", "main.out"]) {
    rmSync(join(SCRATCH, f), { force: true });
  }
  const logoOut = join(SCRATCH, "logo_small.png");
  if (!existsSync(logoOut)) {
    execFileSync(
      "sips",
      ["-Z", "418", join(ROOT, "public", "brand", "logo.png"), "--out", logoOut],
      { stdio: "pipe" }
    );
  }

  const tex = [
    PREAMBLE(doc),
    "\\begin{document}",
    // The cover paints itself noir over this; body pages sit on Mist.
    "\\pagecolor{paper}",
    COVER(doc),
    "\\setcounter{page}{2}",
    documentBody(doc),
    "\\end{document}",
  ].join("\n");
  writeFileSync(join(SCRATCH, TEX_NAME), tex);

  for (let pass = 0; pass < 2; pass += 1) {
    execFileSync("xelatex", ["-interaction=nonstopmode", TEX_NAME], { cwd: SCRATCH, stdio: "pipe" });
  }
  const built = join(SCRATCH, "main.pdf");
  const builtSize = statSync(built).size;

  mkdirSync(OUT_DIR, { recursive: true });
  copyFileSync(built, join(OUT_DIR, "robincalls-overview.pdf"));
  const mdHash = createHash("sha256").update(readFileSync(MD_PATH)).digest("hex");
  writeFileSync(join(OUT_DIR, "robincalls-overview.pdf.sha256"), `${mdHash}\n`);

  console.log(`overview PDF: ${doc.parts.length} parts, ${builtSize} bytes -> public/downloads/robincalls-overview.pdf`);
}

/* ── preamble + cover (the approved v1.1 print design) ──────────────────── */

function PREAMBLE(_doc: OverviewDoc): string {
  return String.raw`% RobinCalls — Project Overview (generated by scripts/build-overview.ts — do not edit)
\documentclass[10pt,letterpaper]{article}
\usepackage{fontspec}
\usepackage[letterpaper,top=3.05cm,bottom=2.5cm,left=2.1cm,right=2.1cm,headheight=2.2cm,headsep=0.9cm,footskip=1.1cm]{geometry}
\usepackage[table]{xcolor}
\usepackage{graphicx}
\usepackage{multicol}
\usepackage{amssymb}
\usepackage{tikz}
\usepackage{eso-pic}
\usepackage{titlesec}
\usepackage{booktabs,array,longtable,tabularx}
\usepackage{fancyhdr}
\usepackage{parskip}
\usepackage{microtype}
\usepackage{enumitem}
\usepackage{setspace}
\usepackage{ragged2e}

\definecolor{noir}{HTML}{0A0A0A}
\definecolor{paperfg}{HTML}{1A1A1A}
\definecolor{coverfg}{HTML}{EDEDEA}
% Body paper: the same "Mist" sage the /overview page's light mode uses
% (globals.css .ov-page[data-theme=light]). One brand, one paper.
\definecolor{paper}{HTML}{EEF0EB}
\definecolor{lime}{HTML}{CAEC0E}
\definecolor{limehot}{HTML}{C4F00A}
\definecolor{muted}{HTML}{6E6E6E}
\definecolor{bordergray}{HTML}{2A2A2A}
\definecolor{limehead}{HTML}{F2FBCF}

\setmainfont{Avenir Next}[
  BoldFont={Avenir Next Bold},
  ItalicFont={Avenir Next Italic},
  BoldItalicFont={Avenir Next Bold Italic},
]
\newfontfamily\condensed{Avenir Next Condensed}[
  BoldFont={Avenir Next Condensed Bold},
]

\newcommand{\asof}[1]{{\small\itshape\color{muted}#1}}

\titleformat{\section}
  {\color{noir}\fontsize{15}{18}\selectfont\bfseries}
  {\textcolor{limehot}{\rule[-1pt]{3.5pt}{13pt}}\hspace{9pt}{\color{noir}\thesection}}{10pt}{\color{noir}}
  [{\vspace{2.5pt}\color{limehot}\rule{\textwidth}{1.1pt}}]
\titlespacing*{\section}{0pt}{18pt}{8pt}
\titleformat{\subsection}
  {\color{noir}\fontsize{12}{15}\selectfont\bfseries}
  {\textcolor{noir}{\thesubsection}}{8pt}{\color{noir}}
\titlespacing*{\subsection}{0pt}{12pt}{4pt}
\titleformat{\subsubsection}
  {\color{noir}\fontsize{10.5}{13}\selectfont\bfseries\itshape}
  {\thesubsubsection}{7pt}{\color{noir}}
\titlespacing*{\subsubsection}{0pt}{9pt}{3pt}

\newcommand{\brandmark}{%
  \raisebox{-2.4pt}{\includegraphics[height=30pt]{logo_small.png}}%
  \hspace{7pt}%
  {\color{noir}\fontsize{14}{14}\selectfont\bfseries ROBINCALLS}%
  \hspace{9pt}%
  {\color{noir!70}\fontsize{7.2}{9}\selectfont\bfseries\addfontfeatures{LetterSpace=6}PROJECT OVERVIEW}%
}
\newcommand{\pageband}{%
  \begin{tikzpicture}[remember picture,overlay]
    \fill[lime] ([yshift=-2.2cm]current page.north west) rectangle (current page.north east);
    \fill[noir] ([yshift=-2.2cm]current page.north west) rectangle ([yshift=-2.28cm]current page.north east);
    \node[anchor=west] at ([xshift=1.55cm,yshift=-1.08cm]current page.north west) {\brandmark};
  \end{tikzpicture}%
}
\newcommand{\coverbg}{%
  \begin{tikzpicture}[remember picture,overlay]
    \fill[noir] (current page.south west) rectangle (current page.north east);
  \end{tikzpicture}%
}

\fancypagestyle{main}{%
  \fancyhf{}%
  \fancyfoot[L]{\color{muted}\fontsize{7.6}{9}\selectfont\addfontfeatures{LetterSpace=2}ROBINCALLS\ \ \textcolor{bordergray}{|}\ \ Trust \& Intelligence Infrastructure for Robinhood Chain}%
  \fancyfoot[R]{\color{noir}\fontsize{8.5}{9}\selectfont\bfseries\thepage}%
  \renewcommand{\headrulewidth}{0pt}%
  \renewcommand{\footrulewidth}{0pt}%
}

\AddToShipoutPictureBG{%
  \ifnum\value{page}>1\pageband\else\coverbg\fi
}

\pagestyle{main}
\setstretch{1.24}
\setlength{\parskip}{0.5em}
\setlength{\emergencystretch}{2em}

\newcolumntype{L}[1]{>{\RaggedRight\arraybackslash}p{#1}}
\setlength{\aboverulesep}{0pt}\setlength{\belowrulesep}{0pt}
\setlength{\extrarowheight}{1.5pt}
\arrayrulecolor{bordergray}

\newcommand{\thead}{\fontsize{8}{9.5}\selectfont\bfseries\addfontfeatures{LetterSpace=3}}
\newcommand{\tcell}{\fontsize{8.8}{11.5}\selectfont}
\newcommand{\status}{\fontsize{8.8}{11}\selectfont\bfseries}`;
}

function COVER(doc: OverviewDoc): string {
  const m = doc.meta;
  return String.raw`\begin{titlepage}
\thispagestyle{empty}
\begin{tikzpicture}[remember picture,overlay]
  \node[anchor=north] at ([yshift=-4.3cm]current page.north) {\includegraphics[height=4.6cm]{logo_small.png}};
  \node[anchor=north] at ([yshift=-10.6cm]current page.north) {%
    \begin{minipage}{\textwidth}\centering
      {\color{coverfg}\condensed\fontsize{34}{38}\selectfont\bfseries\addfontfeatures{LetterSpace=10} ROBINCALLS}\\[14pt]
      {\color{limehot}\fontsize{10.5}{14}\selectfont\bfseries\addfontfeatures{LetterSpace=5}TRUST \& INTELLIGENCE INFRASTRUCTURE FOR ROBINHOOD CHAIN}\\[26pt]
      {\color{coverfg}\fontsize{13}{17}\selectfont ${escapeLatex(m.subtitle)}}\\[10pt]
      {\color{coverfg!70}\fontsize{9.5}{13}\selectfont Version ${escapeLatex(m.version)}, ${escapeLatex(m.date)}}\\[30pt]
      {\color{coverfg!65}\fontsize{9}{13}\selectfont\itshape ${escapeLatex(m.tagline)}}
    \end{minipage}%
  };
  \fill[limehot] ([xshift=6.4cm,yshift=-17.1cm]current page.north west) rectangle ([xshift=-6.4cm,yshift=-17.17cm]current page.north east);
  \node[anchor=south] at ([yshift=1.5cm]current page.south) {%
    {\color{coverfg!55}\fontsize{8}{10}\selectfont\addfontfeatures{LetterSpace=4}ROBINCALLS.COM}%
  };
\end{tikzpicture}
\end{titlepage}`;
}

main();
