# Agent harness plan

Goal: make the editor a reliable, cheap agent harness for building a housing project's website on the fly. Start from a minimal site, learn a design from reference sites, build a design system, then refine pages and content. The agent is free to give each page its own structure and layout. What stays fixed is that layouts and content are separate, and that everything the agent builds is stored in a catalog it can reuse.

This plan comes from reading the code and from a production chat database (`chat.sqlite`, three chats, 53 user turns) plus the live site at schlor.habidat.org. Token counts are estimates (3.5 characters per token). Prices are from the providers' public pages in October 2026.

## 0. Assumptions

- **No backwards compatibility.** The tool has only been tested, not used in production. Stored chats, existing site instances, the current layout files, the seed content and the current tool signatures can all be dropped. A fresh instance is made from setup. The production chats are kept only as prompts and expected outcomes for evals.
- **Layout freedom.** The agent may create a layout for one page. Nothing limits how many layouts a site has. The only hard rules protect the separation of content and design (section 3, Phase 2).
- **Revised decisions.** This replaces ADRs 0005, 0008, 0010 and 0011 in part (see section 5).

## 1. Baseline from production

| Measure | Value |
|---|---|
| Tool calls, three chats | 359 + 106 + 16 |
| `write_page` calls that failed validation | 49 of 194 (25%). 46 of those 49 omitted `lang`, 3 omitted `slug`. Most pages needed 2–4 attempts. |
| Other failures | `write_design` without `path`, `read_design` of a file that does not exist (`room.njk`, `kit.njk`), `read_website` of 404s and non-HTML |
| Prompt tokens re-sent, long import chat | about 88M over 359 tool steps. Final history about 535k tokens. Largest single turn about 12M. |
| Output tokens spent rewriting `styles.css` | 40 full rewrites, about 246k tokens. The stylesheet is about 30 KB and was also read in full several times (31 KB per read). |
| Output tokens, all `write_page` calls | about 64k |
| Website reads | 37 calls, 738 KB in one chat. Raw HTML stays in history for every later step. |
| Layouts created | 14 private layouts (`front`, `raum`, `eventroom`, `ws`, `ops`, `phases`, `structure`, `directions`, `access`, `funding`, `join`, `loans` and others) |
| User turns that were corrections | about 10 of 53: "layout barely changed", "page is blank", "footer broke", "chaotic", "can't publish" |
| Stored reasoning text | 850 KB across the three chats |

What the transcripts show:
- **The agent cannot see its result.** For the Veranstaltungsraum page it used the `room` kit layout with guessed field names. Nothing new rendered, and the agent reported success. A later fade-in script left the whole site at `opacity: 0` (a white page).
- **Many layouts are not the problem, but there is no way to find or reuse them.** The agent created 14 layouts and reused none by choice. It re-read `styles.css` (31 KB) and other layouts each time to remember what existed. Class names collided in the shared stylesheet (`band`).
- **Layout fields are guessed.** Nothing tells the agent which fields a layout reads, so it passes names the layout ignores.
- **Slot-only pages hit a publish check.** Pages whose layout reads slots had an empty body. Publish blocked on a missing German body twice, and the agent invented body text that the layout never shows.
- **Exploration is expensive.** The first turn on a redesign request made 38 tool calls, about 25 of them reads and searches, before writing anything.
- **Bulk imports hit limits.** After the first import turn the agent said it would "write the pages again in smaller packages". `chatErrorText` truncates validation errors, so the real cause is not logged.

## 2. Targets

| Metric | Baseline | Target |
|---|---|---|
| Tool-validation failure rate | 25% of `write_page` | under 3% for every tool |
| Prompt tokens per turn (before caching) | up to 12M, long chats | under 2M. Cache hit rate over 80%. |
| Output tokens for a one-line style tweak | whole 30 KB file | under 1k |
| Corrections needed after a design request | about 1 in 5 turns | 1 in 10 or fewer |
| Words lost or added by a design change | not measured | 0, enforced in code |
| Layouts and sections listed in the catalog with purpose and slots | not tracked | 100% |
| Slots a page sets that its layout does not render | not detected | 0, reported before the reply ends |

There is no target on the number of layouts.

## Status

Phase 0 and Phase 1 are built, with these differences from the plan:
- `write_page` already takes every language at once (`languages`), as a Phase 1 change, because it was the most frequent failure. Phase 2 replaces it with slots.
- The publish check already treats a page as complete when its layout reads slots and they are filled, so a slot-only page needs no invented body text. Phase 2 replaces it with the schema check.
- Tool inputs are checked inside the tool (`lib/tool-kit.ts`) instead of by the SDK. The SDK's own message repeats the whole input, which doubled the cost of every failed page write.
- Pruning (`lib/history.ts`) also drops stored reasoning and stubs the large input of old `write_design` and `write_page` calls, not only old results.
- Eval scenarios run offline except `setup-from-url`. Run them with `pnpm --filter @schlor/editor eval -- --scenario all --base-url … --model …` (key in `LLM_API_KEY`), and print usage from a chat database with `pnpm --filter @schlor/editor report -- --db path/to/chat.sqlite`.
- Not yet measured against a real model; the baseline in section 1 is the comparison to beat.

Phase 2 is built in its first step (see [ADR 0013](adr/0013-site-owned-layouts-with-typed-slots.md)):
- Layouts are folders (`layout.yml`, `template.njk`, `style.css`) with typed slots, and a page is one YAML file with a title per language and slot values.
- Styles of a layout are nested under `body[data-layout="name"]` by the generator, with keyframes and font-face kept outside.
- `design/labels.yml` holds interface words per language. The layout guard refuses visible words in any template and shell, page names in any language, picture addresses and `content:` words in any design file.
- The agent sees a catalog of layouts (purpose, slot signature, pages using it) in the system prompt, and has `list_layouts`, `read_layout`, `write_layout`, `fork_layout`, `delete_layout`, `replace_layout`.
- After a design change the tool lists words a page no longer shows (`lostContent`, from the generated pages).
Phase 3 is built:
- `edit_design`, `edit_layout` (template, style, or layout.yml), `set_slot` and `edit_slot` replace text that appears once, or set one slot or one place in a list or group, with the same checks as the full writes. A change that cannot be placed says why (not there, different spacing, or several matches).
- Dropped from the plan: running the full build only once at the end of a reply. A full generate takes about 0.4 s for 130 pages, and the per-write build is what returns template errors and the "words no longer shown" report to the agent.
- Tool definitions are now about 5.7k tokens and the system prompt about 2.1k, both stable between requests so they are cached.
- `read_layout` already takes a part. `read_design` takes an offset.

Phase 4 is built (looking at the result):
- A browser is optional. `BROWSER_URL` points at a Chromium that speaks the DevTools protocol (tested over a local debugging port), or `BROWSER_PATH` runs a local Chrome. Without either, the tools below do not exist and nothing changes. A Chromium container as a sidecar is the intended setup; Chrome only accepts DevTools connections for `localhost` or an IP address as the host name, so use the container's address (not tested against a real container).
- Pages are served to the browser from the generated draft, and nothing else leaves the machine except Google Fonts.
- `check_page` lists what is wrong at phone width (375px) and desktop width (1280px): text with too little contrast (computed from the real colours behind it), a page that scrolls sideways and what reaches out, pictures that did not load, slot words that are in the page but not visible (hidden by CSS), an invisible page, a missing h1, script errors.
- After every design write (`write_layout`, `write_design`, `edit_layout`, `edit_design`, `replace_layout`) the tool result also carries what the browser found on the pages that show the change (the pages of that layout, or the home page and one page per layout for a shared change). A problem is reported once per request. A browser that fails never fails the change.
- `preview_page` gives a vision model a screenshot (JPEG, whole page to 2400px). It reaches the model as a user message for the next step only, then is gone, so it never stays in the history or the stored chat. Whether a model reads pictures comes from a list of documented models, or `LLM_VISION=1` or `0`.

Phase 5 is built (reading other websites):
- With a browser: `inspect_website` describes how a public page looks in about 300–600 tokens (colors by role, fonts and sizes, corners and shadows, content width, the menu, and the sections from top to bottom with their colors and sizes). A vision model also gets a picture of the whole page for the next step. `read_page_text` gives the page's words as markdown with link and picture addresses, after scripts have run, so hidden email addresses and lazy pictures are in it, and menus, footers and cookie banners are left out. `save_reference` and `read_reference` keep a site the person likes in `design/references/<site>.md`, and the system prompt lists them.
- Without a browser: `read_website` as before. `site_map` (links to the same site and the sitemap, grouped when long) works either way.
- A page is cached for six hours beside the chat database, so asking again does not render it again.
- The reader cannot reach a private address. `safeFetch` checks the address at the moment the socket connects, which closes the gap where a name answers with a public address first and a private one later. The browser never touches the network itself: every request it makes goes through that fetch, with limits on the number and size of requests, no POST, no WebSocket, and no service workers. It sends a normal browser user agent.
- `save_picture` now says to save only a picture the person owns or may use, and the prompt says to copy a look, not a site's words or pictures.
- Tried on schlor.org and two other public sites (5–10 seconds a page).
- Not built: the `import_pages` tool of the plan. The importer package knows one WordPress site; a general bulk import is better built from `site_map` and `read_page_text` once the agent has been seen to use them.

Not built yet: reusable sections shared by several layouts (the starter layouts repeat their markup). The importer package writes the new page format but only knows the old fixed layouts.

## 3. Phases

Each phase can ship alone. The order is by value over effort, except that Phase 2 is the foundation for most of what follows.

### Phase 0: measure first (S)

Without this the targets cannot be checked, and model swaps (GLM, DeepSeek, Kimi) cannot be compared.

- Log per step in `app/api/chat/route.ts`: input, cached and output tokens from the AI SDK `usage`, tool name, validation error, step count. Store beside the chat database.
- Stop truncating validation errors in `lib/api-error.ts` for the log (keep the short text for the UI).
- Turn the production chats into eval scenarios: first user message plus the expected end state for setup from a URL, a layout-only request, a content-only request, and a refine request.
- Add an eval runner that replays a scenario against a model and reports retries, steps, tokens and cost.

Done when: one command prints the table in section 2 for any model.

### Phase 1: cheap fixes to the current tools (S–M)

These do not depend on the new content model. Since nothing needs to stay compatible, replace rather than extend.

1. **Honest schemas.** Anything the description calls "Required" is required in the Zod schema (`path`, and in the interim `lang`). Remove duplicate inputs from `write_event` and `write_place` (`titleDe`, `titleEn`, `nameDe`, `nameEn`). Use `z.preprocess` to accept a string where a language map is expected (assign it to the default language) and a JSON string for `dates`.
2. **One error contract.** Tool failures return `{ ok: false, error, hint }` or throw. No more plain strings that look like success (`Nothing was written`, `Missing page`, `Unknown place`).
3. **Repair invalid input.** Extend `repairUnavailableTool` in `lib/tools.ts` to handle invalid input as well as unknown tools: coerce, or re-ask the model once with the schema error.
4. **Prompt order for caching.** In `systemPrompt`, put the static rules first and the dynamic parts last. Today the brief comes first, so a brief rewrite invalidates the cache for the whole static prompt. DeepSeek cached input is about 50 times cheaper than uncached input.
5. **Dedupe the prompt.** One rule, one place. Use headings instead of one 7k-character paragraph. Remove text that the tool descriptions already carry.
6. **Delete leftover mode code.** Remove `lib/mode.ts`, `reject_tool`, `read_site` (same as `read_website`), the `mode` field in stored chats and the content/design split in `toolsFor`. Setup stays as its own tool set.
7. **Prune old tool output and images.** In `prepareStep`, replace `read_*`, `list_*` and `read_website` results older than the current turn with a one-line stub. Do the same for any image parts, as soon as the step that used them is over (images arrive in Phase 4 and 5; build the pruning here so it is ready). Add a compaction step when history passes a token budget (for example 150k): keep user messages, assistant summaries and commit ids.
8. **Say when output is cut.** `read_website` and `read_design` state when they truncated and how to get the rest.

Done when: the Phase 0 report shows tool-validation failures under 3% and prompt tokens per turn at least halved on the replayed scenarios.

### Phase 2: site-owned layouts, sections, slots and a catalog (L)

This replaces the kit's closed set of section shapes and the split between section-list layouts and private templates.

**Layouts are units the site owns.** Each layout is a folder:

```
design/layouts/<name>/
  layout.yml     purpose (one line), slot schema, tags
  template.njk   markup. Text comes only from slots and labels.
  style.css      styles for this layout only
```

- **Typed slots.** A slot has a type: `text`, `markdown`, `image`, `link`, `date`, `list<T>`, or a group of slots. It says whether it is required and whether it is translated. Images and links are stored once; text is stored per language. The schema is where "every page gets a different content system" lives: the page's content shape is the layout's slot schema.
- **Sections are reusable parts.** A section is a partial template with its own slot schema (hero, cards, band and so on). A layout composes sections and declares them as slot types, for example `cards: list<card>`. The starter set in the seed is the current 11 shapes, copied into the site so the agent can edit or fork them. Adding a shape no longer needs a software change.
- **Scoped styles.** The generator wraps each page in `layout-<name>` and nests the layout's `style.css` under it, so one layout cannot restyle another and class names cannot collide. Shared look stays in `tokens.css` and `base.css`. The shell has its own file. There is no 30 KB stylesheet to rewrite.
- **UI labels.** Short interface strings such as "When?", "Where?" or "Read more" live in `design/labels.yml` with a value per language and are used in templates as `{{ t('when') }}`. They belong to the design, not to a page, and need translating once.
- **Pages.** One file per page, `content/pages/<slug>.yml`: `layout`, `date`, and `slots` with values. Translated values hold one entry per language; images and links are stored once. This removes the one-file-per-language drift behind the missing German page and the half-saved pages. Markdown stays markdown inside the slot.
- **Catalog.** The generator builds `design/catalog.yml` from the layout and section folders: name, purpose, slot signature (for example `title:text*, lede:text, hero:image, items:list<card>`), and which pages use it. A compact version goes into the system prompt (about 40 tokens per layout). The agent reuses a layout when its slots fit, forks one when close (`fork_layout`), or writes a new one. It may do any of these for a single page.
- **Brief.** `design/brief.md` shrinks to the shared look. Each layout's purpose lives in its own `layout.yml`, so there is no per-layout line to rewrite.

**Tools.**
- `list_layouts`, `read_layout(name)` (template, schema, style and one example of slot values from a page using it), `write_layout({name, purpose, slots, template, style})` as one atomic write, `fork_layout(from, to)`, `delete_layout(name)` (moves pages or refuses while pages use it), plus the same trio for sections.
- `write_page({slug, layout, date?, slots})` writes every language at once and validates `slots` against the layout schema. A missing required slot, an unknown slot, or a wrong type is reported with the schema.
- `write_layout` checks that the template only references declared slots, that every declared slot is rendered somewhere, and that sections referenced exist.

**What the guard enforces (and nothing more).**
1. **No literal text in a design file.** After removing tags and Nunjucks tags, a layout, section or shell template may hold no visible words. Text comes from slots or labels. This replaces the 8-word prose heuristic, and it also closes the gaps for short taglines and for the shell.
2. **No page names and no picture addresses in design files.** Keep the current page-name check, but compare against titles in every language. No `/media/` in templates or CSS.
3. **Page content cannot hold design.** The sanitizer already strips class, style and script from content.
4. **Content-preservation check.** After a design write, render every page and confirm each slot value still appears in the output. Flag output text that came from neither a slot nor a label. Use the markers `markContent` already produces. The reply reports "0 words changed" or lists what changed.
5. **Publish check** follows the schema: required slots must be filled in every non-optional language. A page whose layout has no body slot needs no body.

Everything about structure (how many layouts, what they look like, whether a layout serves one page) is the agent's decision.

Done when: setup from a URL creates layouts with slot schemas and pages that fill them with no guessed field names, and a layout-only request can neither add nor drop a sentence.

### Phase 3: patch tools (M)

- `edit_layout({ name, part: 'template'|'style'|'layout', find, replace })` and `edit_shell` / `edit_tokens` likewise. The find string must match once; otherwise return the number of matches. Rebuild only the touched layout while the agent works, and run the full `generate` once at the end of the reply.
- `set_slot({ slug, slot, lang?, value })` and `edit_slot({ slug, slot, lang, find, replace })` for small content edits. Reuse `applyContentCorrection` in `packages/generator/src/hints.ts`. This ends the full-body rewrite for a one-word change and the read-before-write rule.
- `read_layout` accepts a part, so the agent can read the template without the style.

Done when: a "change the accent colour" request costs under 1k output tokens and one full build.

### Phase 4: verify before claiming (L)

- `check_page({ slug, viewport })` renders the generated page in headless Chromium (Playwright, added to the Dockerfile) and returns text findings: slots not rendered, empty sections, text contrast under 4.5:1, horizontal overflow at 375 px, the whole page at opacity 0, missing images, console errors.
- `preview_page` returns a screenshot to the main model. There is no separate vision model. Once the agent has used a screenshot (the end of the step that received it), the image is replaced in the history by a one-line stub such as "screenshot of /werkstatt at 375 px, dropped", so it is not re-sent on later steps or turns. The stored chat keeps the stub, not the image. A text-only model gets the `check_page` text findings and no image.
- Verification gate: after a reply that wrote design files, the harness runs `check_page` on the affected pages and gives the agent one repair step with the findings. The reply may not claim a change until its check passes.
- Fold the existing `unusedFieldNote` and `documentOpacityRefusal` checks into this.

Done when: the Veranstaltungsraum and fade-in failures from the production chat are caught inside the same reply.

### Phase 5: read websites for design (L)

- `inspect_website(url)`: render with headless Chromium, return a design profile of about 600 tokens: palette with roles (page background, text, heading, link, button, header, footer), fonts and sizes of body and headings, radius and spacing, the section sequence of the page, and stored desktop and mobile screenshots.
- `read_page_text(url)`: readable text as markdown, with image addresses, instead of raw HTML. Replaces `read_website`.
- `site_map(url)`: internal links and `sitemap.xml` entries so the agent chooses pages.
- Cache fetched pages and profiles on disk by URL.
- Store each profile as `design/references/<host>.md` with the person's remark (for example "liked the hero, not the menu"). The brief links to them, and `read_reference` recalls them.
- Read reference sites in a sub-call that returns only the profile, so raw HTML never enters the main history.
- Fix `assertPublicUrl` so the address that was checked is the one that is fetched (DNS rebinding). Send a normal browser user agent. Note image licences in `save_picture`.
- For imports of many pages, reuse `packages/importer` (see `structure.ts`) behind an `import_pages` tool with progress, instead of 15+ separate reads and one huge write turn.

Done when: setup from a WordPress site produces a profile with correct palette roles and fonts without the agent reading any HTML.

### Phase 6: design system and durable rules (M)

- `design/tokens.yml`: palette roles (including an on-colour for text over fills), type scale, spacing, radius, widths. The generator builds `tokens.css` and the Tailwind theme from it. A compact summary goes in the prompt.
- Token lint is a warning, not a refusal. `write_layout` and `check_page` report raw hex colours, Tailwind arbitrary values, fonts that are not tokens, and inline styles, and name the token to use. A site may turn it into a refusal. The agent stays free to design; the lint keeps the look consistent.
- `design/rules.md`: short durable preferences ("no full-bleed photos"). The agent appends when the person states one. Included in the prompt.
- Catalog hygiene: the catalog flags near-duplicate layouts (same slot signature) and layouts no page uses, as suggestions, never as blocks.

Done when: a second chat on the same site stays inside the palette and fonts the first chat set up, and states which rule or reference it followed.

### Phase 7: model routing and provider checks (S)

- A setting per task type: cheap model for content edits, stronger model for setup and design.
- Thinking on or off per request type.
- Test DeepSeek thinking mode with tool calls. `lib/gemini.ts` already carries Gemini thought signatures between steps; DeepSeek may need its reasoning text sent back during a tool loop, or thinking turned off. Not verified.
- Tell the agent to read several files in one step. `read_page` returns all languages.

## 4. What this lets us delete

- Section-list layouts (`.yml`) and the `.njk`/`.yml` split in `readDesignFile`, `layoutShapes`, `layoutLabel` and `missingDesign` in `lib/tools.ts`.
- `lib/section-fields.ts` (`sectionListNote`, `unusedFieldNote`) and the shapes in `packages/generator/shapes`, which move into the seed as site-owned sections.
- The per-language page files, the `fields` merge in `write_page`, and the sibling-language check.
- `lib/mode.ts`, `reject_tool`, `read_site`, stored chat `mode`.
- The 8-word prose heuristic in `lib/layout-guard.ts`.
- The seed brief's per-layout lines, and the existing instances and chats.

## 5. Decisions needed and ADRs

Decisions:
1. **Page storage:** one YAML file per page with slots. Decided.
2. **Section name:** keep "Section". It is already in the glossary and the prompts, and the person says "Sektion" in the production chats.
3. **Events and places:** their data stays as typed records (`fields.yml`, `content/events`, `content/places`), because the calendar, iCal export and filters depend on a fixed shape. Their templates (event page, calendar, archive, and any list page) move into the same layout-folder format, so the agent edits them with the same tools and the catalog lists them.
4. **Chromium: added.** Default is a sidecar container with headless Chromium, which the editor reaches over the DevTools protocol (Playwright `connect`), so the editor image stays as it is. Installing it into the editor image instead adds roughly 300–500 MB to the current `node:22-bookworm-slim` base (not measured; build both and compare with `docker images`) and is the fallback if a sidecar is awkward in the habidat-setup deployment. Use one shared browser, a larger `/dev/shm`, and a render timeout. Renders of the draft are private and local; only public pages that the person names are fetched from outside, and they go through the existing address checks.
5. **Screenshots: main model only, dropped from history.** No separate vision model. A screenshot is sent to the main model for the step that needs it, then replaced by a one-line stub in the history. Check once that the chosen provider accepts images in the chat format (DeepSeek's `deepseek-flash` lists vision support; not verified). A text-only model works from the `check_page` findings.

ADRs to write:
- **Site-owned layouts with typed slots and a catalog.** Supersedes 0005 (structured fields), 0008 (section shapes), 0010 (private layout reads slots) and the page-file part of 0001. Records why the closed shape set and the per-language page files were dropped.
- **No literal text in design files; labels for UI strings.** Replaces the prose heuristic.
- **Verification gate before a reply may claim a change** (Phase 4).
- **Content-preservation check on every design write** (Phase 2).
- 0011 (one editor mode) stays and is finished by Phase 1.

Glossary terms to add or change when built: **Layout** (now a folder with a slot schema), **Slot** (typed, per layout), **Section**, **Catalog**, **Label**, **Design token**, **Reference**, **Rule**.

## 6. Suggested order

1. Phase 0, then Phase 1. These are small and cut cost and failures immediately.
2. Phase 2, the foundation. Write its ADR first. It can be built in two steps: slots and `write_page` first, then layouts as folders with the catalog and scoped styles.
3. Phase 3, then Phase 4.
4. Phase 5, then Phase 6 and Phase 7.
