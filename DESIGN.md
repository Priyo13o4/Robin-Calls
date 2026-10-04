---
name: "design-system-noir"
category: Brands
surface: web
colors:
  background: "#0a0a0a"
  foreground: "#ededea"
  electric-lime: "#ccff00"
  near-black: "#0a0a0a"
  surface-1: "#141414"
  surface-2: "#1c1c1c"
  smoke: "#8a8a8a"
  fog: "#3d3d3d"
  border: "#2a2a2a"
---

RobinCalls is the community and brand layer of a crypto-native risk intelligence platform built on Robinhood Chain. The brand fuses the Robin Hood archetype — the vigilante who closes the information gap between insiders and everyday traders — with a noir-detective aesthetic. The mascot is a Batman-silhouette archer: anonymous, precise, watching from the shadows. The core narrative is "Answer the Call" — a rallying cry for traders who demand signal over noise.

The visual identity has shifted from a bright dual-tone system to a **desaturated noir world with a single point of color.** The canvas is near-black (#0A0A0A), rendered in monochrome — grayscale photography, high-contrast chiaroscuro illustration, film grain. Electric Lime (#CCFF00) no longer functions as a background; it is now reserved, deliberate, and rare — the one color allowed to exist in an otherwise colorless world. Think Sin City's single red coat cutting through black-and-white film: when lime appears, it means something. That discipline *is* the design system now. If lime shows up everywhere, the device is dead — it only works because it's scarce.

## Color Palette

| Role | Name | Hex | Usage |
| --- | --- | --- | --- |
| background | Near Black | #0a0a0a | primary canvas, all pages by default |
| foreground | Paper | #ededea | body text and headings — a warm off-white, not clinical pure white, for a filmic/aged-paper feel |
| surface (elevated) | Surface 1 | #141414 | cards, panels, section breaks |
| surface (deep elevation) | Surface 2 | #1c1c1c | nested cards, modals, tooltips |
| primary body copy | Mist | #c4c4c4 | evidence sentences, check reasons, any prose the user is actively reading — one step down from Paper, not Smoke |
| secondary text | Smoke | #8a8a8a | metadata, timestamps, labels, JSON syntax — body-weight enough to read at a glance against Near Black / Surface 1 |
| tertiary text | Fog | #3d3d3d | disabled states, placeholder text, purely decorative labels only — never for copy the user is meant to read |
| border | Border | #2a2a2a | rules and dividers |
| **accent — sole color** | **Electric Lime** | **#ccff00** | reserved exclusively — see Lime Usage Rules below |

## Lime Usage Rules

This is the actual design system now — more important than any hex code.

**Lime is allowed for:**
- The Call Score number itself, and only the number — nothing else in that card
- Primary CTA button fill (one CTA per view gets this treatment, not every button)
- Hard-block alert states — a confirmed honeypot flag, an unlocked LP. Reserved for genuine danger, which is exactly why it should be rare
- A single focal highlight inside an illustration — one lit window in a skyline, the mascot's eyes, one glint of light on a blade. Never more than one lime element per composition
- Active/hover states on interactive elements — a brief, temporary hit of color, not a resting state

**Lime is never allowed for:**
- Page or section backgrounds, at any size
- Decorative fills, dividers, or icons with no functional meaning
- Body text or secondary UI chrome
- More than one element in the same viewport, as a rule of thumb — if you're using it twice, ask why

If in doubt, don't use it. Scarcity is the entire mechanism.

## Typography
- Display: Cinzel – weights 600, 700, 900 – fallbacks: Georgia, "Times New Roman", serif
- Body: Inter – weights 400, 500 – fallbacks: system-ui, -apple-system, Segoe UI, Helvetica Neue, Arial, sans-serif
- Default text color is now Paper (#ededea) on Near Black — inverted from the previous near-black-on-lime relationship. In a hero headline, render the full line in Paper and reserve lime for a single word or numeral within it (e.g., a score, or one emphasized term) rather than coloring the whole headline.

## Voice & Tone

Voice: Bold, cryptic, precise. RobinCalls speaks like a seasoned trader who has seen every market cycle — confident without arrogance, urgent without panic. Never corporate. Never soft.

Tone principles:
- Vigilante authority — Speak as the one who sees what others miss. Declarative sentences. Short punches.
- Myth meets machine — Pair legendary/epic language with hard data. "The Call Score™ doesn't lie. 94. Act accordingly."
- Community first, analytics always — Warm to the in-group, credible to the skeptic. Never hype without substance behind it.
- Earned confidence — The brand doesn't shout. It states. Let the hash-chained receipts do the talking.
- The one signal that cuts through — the noir visual device (one color, everything else colorless) is the same idea as the product: most of the chain is noise, we surface the one number that matters. Copy can lean on this parallel when useful, without forcing it into every line.

Do say: "Answer the Call." / "Score. Signal. Strike." / "On-chain. On record. On time."
Don't say: "We're excited to announce..." / "To the moon!" / "DYOR" (we ARE the research)

Writing style: Short paragraphs. Fragments welcome. Imperative mood for CTAs. Use italics for emphasis on key terms. Numbers are always exact — never approximate.

## Imagery

- Style: Full desaturation. Monochrome photography and illustration — grayscale only, no exceptions, so that lime's rare appearances actually register.
- Subjects: Abstract landscapes, silhouettes, or architectural elements that convey scale and mystery. Detective-noir motifs welcome — venetian-blind light bars, rain-slicked streets, cigarette smoke, deep shadow — as long as they stay in the genre, not any specific copyrighted character.
- Treatment: Hard chiaroscuro — strong, directional contrast between black and white, minimal midtones. Film grain texture encouraged for period authenticity. Retain `mix-blend-multiply` blending, now applied against the near-black canvas rather than lime. Each composition gets exactly one deliberate lime highlight (see Lime Usage Rules) — never zero, never more than one, in imagery that's meant to carry brand weight.
- Avoid: Corporate illustrations, overly complex 3D renders, colorful photography, or any use of lime as a fill rather than a single accent point.

## Layout & Interaction Details

- **Radius:** 0px (sharp, brutalist corners) for interactive elements and value cards.
- **Border weight:** 2px solid borders for defined structural elements and cards, establishing a heavy comic-style box outline.
- **Brutalist Offset Shadows:** Buttons and value cards use solid, unblurred drop shadows (e.g., `6px 6px 0px 0px`). Light themes use `#EDEDEA` shadows, dark themes use `#3D3D3D`.
- **Halftone Noise:** Backgrounds of interactive elements or value cards receive a subtle, comic-style dotted halftone noise pattern via `radial-gradient(color 20%, transparent 20%)` with a `4px 4px` background size to add tactile grit.
- **Physical Press Hover States:** Hovering over a brutalist element translates it down and right (`6px, 6px`) while removing the shadow, simulating a heavy mechanical button press.
- **Spacing:** 8px baseline grid

### Posture rules
- Hero sections should feel expansive and spacious — unchanged.
- Typographic scales remain massive for display text (up to 12rem on large screens), now rendered primarily in Paper against Near Black, with lime reserved for a single emphasized word or numeral per hero, not the full headline.

### Legibility Rules
- Never stack a Tailwind `opacity-*` modifier on top of Smoke or Fog text — those colors are already dimmed relative to Paper; an added opacity halves contrast again and makes the copy unreadable. If something needs to look more muted, drop it to Fog rather than adding opacity to Smoke.
- **Footnotes, captions, and helper text are body copy, not decoration.** An explanatory sentence under a table, chart, stat block, or form field (e.g. the "Last ~300 trades…" note under Top Traders, a form-field hint) is meant to be read — it gets **Smoke (`#8a8a8a`) minimum, never Fog (`#3d3d3d`)**, regardless of how small it is. Fog is reserved for genuinely non-readable elements only: single-character dividers (`·`, `—`), inactive step indicators, disabled/placeholder states, and corner tags on a graphic. If a human is expected to parse the words, it is not Fog.
- Type scale floor, by role:
  - **Titles/labels** (check names, card headers): 12–13px, Paper.
  - **Body copy the user is meant to read** (check reasons, evidence sentences, descriptions): 13px minimum, Mist — this is the content people are actually there to read, so it doesn't get the same tiny treatment as chrome.
  - **Metadata/buttons/JSON** (source lines, weight tags, VIEW RAW DATA, syntax-highlighted evidence): 11–12px, Smoke.
  - **Decorative tags only** (a corner badge on a stamp graphic, a single-character divider): 9–10px — never for a sentence or a value the user needs to parse.
- Raw-data / evidence panels (VIEW RAW DATA, JSON viewers) always ship a COPY JSON button so the underlying evidence can be pulled without manual selection.
- **Contract & Address Interaction Rules:** Every important smart contract or wallet address rendered in the UI (e.g., token cards, trusted infrastructure tables, verdict headers, evidence panels) MUST feature an explicit copy button or interactive copy chip. The chip should display the address, feature on-hover green accent border highlighting (`hover:border-[#ccff00]`), and trigger visual copy feedback ("COPIED" state + green checkmark) upon click.

### Raw Data & JSON Rendering
- When displaying raw data, logs, evidence payloads, or JSON objects (e.g., in "VIEW RAW DATA" panels), use custom syntax highlighting to maintain the noir theme while prioritizing legibility, at 12px minimum:
  - **Keys / Field Names:** Paper (`#ededea`) for crisp readability.
  - **Values (Strings, Numbers, Booleans, Null):** Electric Lime (`#ccff00`) to make the actual data pop.
  - **Syntax (Braces, Brackets, Commas, Colons):** Smoke (`#8a8a8a`) to keep the structure visible but heavily muted.
  - Do not use default gray plain-text or generic colorful syntax highlighters that break the single-accent-color rule.