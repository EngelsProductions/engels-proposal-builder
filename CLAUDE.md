# Engels Productions — Proposal Builder

A single-file web tool that assembles branded video-production proposals. The user
(Jack Gilbey, Engels Productions) fills in client details, ticks which sections to
include, edits copy, and exports a PDF. It is hosted on Vercel and auto-deploys from
this GitHub repo on every push to `main`.

## The one rule that matters most

**Never regenerate or redesign the document. Only ever change content and structure.**
The whole point of this tool is that the design is LOCKED so proposals never look
"AI-generated." When asked to add or change something:
- Reuse the existing styled blocks (section bar, callout box, pricing table, footer).
- A new section = new content poured into an existing component, NOT a new design.
- Do not introduce new fonts, colours, shadows, gradients, or layout patterns unless
  explicitly asked. Match what is already there.

## File structure

- `index.html` — the entire app: HTML, CSS, and JS in one file. There is no build step.
  - Embedded assets: the logo and cover photo are base64 data URIs near the top of the
    `<script>` (`LOGO`, `COVER_DEFAULT`). Do not remove or re-encode these.
  - `SECTIONS` array = the toggleable sections. `secHTML(id)` renders each one.
  - `customs` = user-added bespoke sections.
  - `calc()` = pricing maths. `render()` = rebuilds the live preview + paginates.

## Brand (from official guidelines — do not deviate)

- Navy:  `#0A0A2C`  (headers, section bars, footer text)
- Blue:  `#34B3E5`  (accent, client band, totals, links)
- White: `#FFFFFF`
- Font:  **Poppins** (loaded via Google Fonts). Alternative per guidelines: Avenir.
- Cover treatment: photos get a navy→blue duotone/gradient wash automatically. Keep this.
- Tone of copy: considered, premium, quietly confident. British English spelling
  ("optimise", "colour", "programme"). No filler, no hype.

## Pricing logic (keep consistent)

- Effective rate per video = monthly price ÷ videos per month.
- Saving vs ad hoc = (videos × ad-hoc rate) − monthly price.
- These are computed live in `calc()`; never hard-code the results.
- Engels Productions is NOT VAT registered — keep that note on pricing pages.

## Making changes

- Edit `index.html` directly. Keep everything in the one file.
- localStorage persists ONLY the saved drafts (the Drafts panel — keys `ep_drafts_v1`
  and `ep_current_v1`). Everything else stays in memory; a browser with no saved drafts
  starts from the built-in defaults. Do not use storage for anything beyond drafts.
  Uploaded cover photos are downscaled (max 2200px, JPEG) so drafts fit the storage quota.
- After editing, show the diff, then commit and push to `main`. Vercel redeploys.
- Suggested commit style: short imperative summary, e.g. "Add event-coverage section".
- Before big structural changes, note that the current version is recoverable via
  GitHub history and Vercel's previous deployments.

## Do NOT

- Do not rename `index.html` (Vercel serves it at the site root).
- Do not commit any API keys or secrets to this repo.
- Do not swap the embedded logo/cover for placeholders.
