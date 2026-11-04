## Design context — read before any design, UX or UI work

Product: NoahOS. "This product" in any request means this product; use this name wherever a name is needed (e.g. the Mobbin collection).

Read these once per session, before the first design, UX or UI task, and build on them. After that, re-read only files that changed, plus the files each command names. Do not contradict a settled decision without asking the designer first.

- PRODUCT.md — product truth (Impeccable `init` owns it).
- DESIGN.md — the designer's own visual system, documented from the app's code (Impeccable `document`). Never replace it.
- design/decisions.md — every settled decision. Read it first; append new decisions to it.
- design/context.md, landscape.md, research-plan.md, findings.md, brief.md, patterns-*.md, journey.html, sitemap.html, copy.md, metrics.md — product-wide UX record (Intent owns them).
- When working on a feature: its journey-<feature>.html, states-, responsive-, evaluation-, accessibility-, audit- and todo- files.

Read when the task touches layout or look (wireframes, building or restyling UI, adapt, harden, any visual fix):

- design/inspiration/ and dump/ — the designer's visual direction. Follow them for layout and look. Don't open everything: list design/inspiration/ and open only the screenshots whose file names match the task (the name says what to take); for dump/, look at the running copy at its reference URL and open only the files for the section in question. DESIGN.md wins on exact values (colours, fonts, spacing) because it records the built app. Intent uses them for layout only, never colour or type.
- They are other companies' work: never treat them as product facts, brand or copy for this product, and never record their names, logos or claims in PRODUCT.md, DESIGN.md or design/. Research and planning (context, landscape, brief, journey, copy) do not use them.
- Never treat dump/ as this app's code: no tokens or components from it in DESIGN.md or design/, no as-built reviews of it, never edit, lint or build files inside it. Reading it to port or match a section into the app is fine.

Open only when a command names them:

- design/wireframes-*.html — optional grayscale layout ideas from Intent; ideas, not instructions.
- .impeccable/ internals (surfaces, critique reports, config) — Impeccable loads what it needs.
- ~/Development/UIUX.MD — the workflow guide, for the designer.

Rules:
1. Creativity is the designer's: never invent a visual direction, palette, type or mock-up. Follow design/inspiration/, dump/ and DESIGN.md. Layout ideas only via Intent wireframe when the designer asks.
2. Every UI edit is a refinement: keep the existing layout and visual style; change only what was asked.
3. One skill per request.
4. Intent never names colour or type.
5. UX precedence: PRODUCT.md › brief › journey › copy deck › states. Visual truth: the code, recorded in DESIGN.md.
6. Log reopenable decisions in design/decisions.md.
7. Loop-back budget: 2 per feature.
