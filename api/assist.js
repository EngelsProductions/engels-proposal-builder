// Serverless proxy for the in-app AI assistant.
//
// The app is a public static page, so the API key can never live in index.html —
// it is read here from the ANTHROPIC_API_KEY environment variable set on the Vercel
// project. The browser calls /api/assist; only this function talks to Anthropic.
//
// Claude never writes markup. It answers with tool calls that name existing fields
// and list entries, and the browser applies them through the same code paths as the
// control panel — so the locked proposal design cannot be altered from here.

import Anthropic from "@anthropic-ai/sdk";

// thinking is on by default on this model and a request can take a while; the Vercel
// default of 10s would cut it off mid-answer
export const config = { maxDuration: 60 };

const client = new Anthropic();

const FIELDS = [
  "client", "title", "date", "version", "opening_line", "about_body",
  "key_aspects_intro", "quote_options_intro", "project_quote_intro",
  "retainer_note", "next_steps", "portfolio_intro", "portfolio_url",
  "portfolio_link_label", "retainer_row_label", "ad_hoc_rate",
  "day_rate_dop", "day_rate_editor",
  "project_quote_total_label", "quote_options_total_label",
  "quote_options_per_video_label", "sign_off",
];

const SECTIONS = [
  "toc", "about", "keyaspects", "includes", "portfolio", "scope",
  "quote", "options", "rates", "terms", "retainer", "next",
];

// the Quote Options ladder: a column always keeps its rung, whatever it is retitled to
const TIERS = ["Essential", "Standard", "Enhanced", "Premium", "Premium+"];

// the lists whose entries can be reordered
const LISTS = [
  "key_aspects", "key_terms", "retainer_terms", "project_quote_items",
  "project_quote_explanations", "quote_options_rows", "quote_options_explanations",
];

// the plain on/off switches in the control panel
const OPTIONS = ["ad_hoc_column", "quote_day_columns", "equal_option_columns", "retainer_terms"];

// every update/remove tool takes this: it names what the entry at that index currently says, and
// the change is refused if it says something else. Cheap insurance against editing the wrong row.
const EXPECT = {
  type: "string",
  description:
    "The heading, label or category the entry at that index currently has, copied exactly from the " +
    "state you were given. Always send it. If it does not match, the change is refused rather than " +
    "applied to the wrong entry.",
};

const TOOLS = [
  {
    name: "set_field",
    description:
      "Set one of the proposal's text fields. Use for the client name, dates, intro copy, " +
      "the About body, day rates, and similar single values. Rates are plain numbers with no currency symbol.",
    input_schema: {
      type: "object",
      properties: {
        field: { type: "string", enum: FIELDS, description: "Which field to set." },
        value: { type: "string", description: "The new value. Replaces the field entirely." },
      },
      required: ["field", "value"],
    },
  },
  {
    name: "add_cost_explanation",
    description:
      "Add a cost explanation beneath a pricing table — a short bold label and text explaining " +
      "why something costs what it does or what it covers. This is the right tool for explaining an " +
      "approach, a crew choice, or what a line item includes, and the one place bullet points can sit " +
      "outside the Key Aspects box.",
    input_schema: {
      type: "object",
      properties: {
        section: { type: "string", enum: ["quote", "options"], description: "Which pricing table it sits under." },
        label: { type: "string", description: "Short bold lead-in, e.g. 'Why four camera angles'." },
        text: { type: "string", description: "The explanation. Normally one paragraph; a line starting with '- ' becomes a bullet, and a line like '| Videos | Rate | Total |' becomes a table row (first one is the heading) for a worked example." },
      },
      required: ["section", "label", "text"],
    },
  },
  {
    name: "update_cost_explanation",
    description: "Rewrite an existing cost explanation, identified by its position in the list (0 is the first).",
    input_schema: {
      type: "object",
      properties: {
        expect: EXPECT,
        section: { type: "string", enum: ["quote", "options"] },
        index: { type: "integer", description: "Zero-based position in that section's explanation list." },
        label: { type: "string", description: "New label. Omit to leave unchanged." },
        text: { type: "string", description: "New text. Lines starting with '- ' become bullets; lines of '| cell | cell |' become a table. Omit to leave unchanged." },
      },
      required: ["section", "index"],
    },
  },
  {
    name: "remove_cost_explanation",
    description: "Delete a cost explanation by its position in the list.",
    input_schema: {
      type: "object",
      properties: {
        expect: EXPECT,
        section: { type: "string", enum: ["quote", "options"] },
        index: { type: "integer" },
      },
      required: ["section", "index"],
    },
  },
  {
    name: "add_key_aspect",
    description:
      "Add a line to the Key Aspects callout — the blue box of bold-label-then-text points. " +
      "This is how bulleted points are presented in this proposal; use it when asked for bullets, " +
      "adding one call per bullet.",
    input_schema: {
      type: "object",
      properties: {
        label: { type: "string", description: "The bold lead-in, a few words." },
        text: { type: "string", description: "The point itself, one or two sentences." },
      },
      required: ["label", "text"],
    },
  },
  {
    name: "update_key_aspect",
    description: "Reword an existing Key Aspects line, identified by its position (0 is the first).",
    input_schema: {
      type: "object",
      properties: {
        expect: EXPECT,
        index: { type: "integer" },
        label: { type: "string", description: "New bold lead-in. Omit to leave unchanged." },
        text: { type: "string", description: "New text. Omit to leave unchanged." },
      },
      required: ["index"],
    },
  },
  {
    name: "remove_key_aspect",
    description: "Delete a Key Aspects line by its position.",
    input_schema: {
      type: "object",
      properties: {
        expect: EXPECT,
        index: { type: "integer" },
      },
      required: ["index"],
    },
  },
  {
    name: "update_custom_section",
    description:
      "Rewrite a bespoke section's heading or content, identified by its position (0 is the first). " +
      "Any photos and callout boxes in the section are kept where they are — sending body replaces " +
      "only the writing around them.",
    input_schema: {
      type: "object",
      properties: {
        expect: EXPECT,
        index: { type: "integer" },
        title: { type: "string", description: "New heading. Omit to leave unchanged." },
        body: {
          type: "string",
          description:
            "New content, same conventions as add_custom_section ('## ' sub-heading, '- ' bullet, " +
            "'| a | b |' table row). Omit to leave unchanged.",
        },
      },
      required: ["index"],
    },
  },
  {
    name: "remove_custom_section",
    description: "Delete a bespoke section by its position.",
    input_schema: {
      type: "object",
      properties: {
        expect: EXPECT,
        index: { type: "integer" },
      },
      required: ["index"],
    },
  },
  {
    name: "update_retainer_tier",
    description:
      "Change a Monthly Retainer Options column by its position (0 is the left-most). " +
      "Each tier is a number of videos per month at a monthly price; the effective rate per " +
      "video and the saving are recalculated automatically.",
    input_schema: {
      type: "object",
      properties: {
        index: { type: "integer", description: "Zero-based column position." },
        videos_per_month: { type: "number" },
        monthly_price: { type: "number" },
      },
      required: ["index"],
    },
  },
  {
    name: "add_custom_section",
    description:
      "Add a bespoke section: a navy section bar with a heading, followed by content. It is added " +
      "at the end of the document; the user drags it wherever they want it. Use only when the " +
      "content does not belong in an existing section.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Section heading. Rendered in capitals." },
        body: {
          type: "string",
          description:
            "The content. Blank lines separate paragraphs. A line starting '## ' is a sub-heading, " +
            "'- ' a bullet, and '| a | b |' a table row (the first such line is the heading row).",
        },
      },
      required: ["title", "body"],
    },
  },
  {
    name: "add_quote_item",
    description: "Add a line item to the Project Quote table. The line total is day rate x days, computed automatically.",
    input_schema: {
      type: "object",
      properties: {
        category: { type: "string", description: "Left-hand category, e.g. 'Principal photography'." },
        description: { type: "string", description: "What it covers." },
        day_rate: { type: "number", description: "Day rate in pounds, number only." },
        days: { type: "number", description: "Number of days." },
      },
      required: ["category", "description", "day_rate", "days"],
    },
  },
  {
    name: "update_quote_item",
    description: "Change an existing Project Quote line item by its row position (0 is the first).",
    input_schema: {
      type: "object",
      properties: {
        expect: EXPECT,
        index: { type: "integer", description: "Zero-based row position." },
        category: { type: "string" },
        description: { type: "string" },
        day_rate: { type: "number" },
        days: { type: "number" },
      },
      required: ["index"],
    },
  },
  {
    name: "remove_quote_item",
    description: "Delete a Project Quote line item by its row position.",
    input_schema: {
      type: "object",
      properties: {
        expect: EXPECT,
        index: { type: "integer" },
      },
      required: ["index"],
    },
  },
  {
    name: "add_option_row",
    description:
      "Add a row to the Quote Options comparison table — the one with a column per tier. " +
      "Give a price for each column you want filled. This is a different table from the Project Quote; " +
      "check which one the proposal is actually using before choosing.",
    input_schema: {
      type: "object",
      properties: {
        category: { type: "string", description: "Row label down the left-hand side." },
        values: {
          type: "object",
          description:
            "Value per column, keyed by the exact column name shown in quote_options_columns. " +
            "A number is shown as a price ('900' prints as £900); a number prefixed with # is shown " +
            "as a plain count and is not treated as money ('#3' prints as 3, for things like a number " +
            "of videos or revision rounds); the word 'yes' becomes a tick; short text such as " +
            "'2 rounds' or 'Unlimited' is shown as written. Omit a column to leave it blank.",
          additionalProperties: { type: "string" },
        },
      },
      required: ["category", "values"],
    },
  },
  {
    name: "update_option_row",
    description: "Change an existing Quote Options row by its position (0 is the first).",
    input_schema: {
      type: "object",
      properties: {
        expect: EXPECT,
        index: { type: "integer", description: "Zero-based row position." },
        category: { type: "string", description: "New row label. Omit to leave unchanged." },
        values: {
          type: "object",
          description: "Columns to change, keyed by column name. Columns you omit keep their current value.",
          additionalProperties: { type: "string" },
        },
      },
      required: ["index"],
    },
  },
  {
    name: "remove_option_row",
    description: "Delete a Quote Options row by its position.",
    input_schema: {
      type: "object",
      properties: {
        expect: EXPECT,
        index: { type: "integer" },
      },
      required: ["index"],
    },
  },
  {
    name: "add_term",
    description:
      "Add a term to Key Terms & Conditions: a short heading and a paragraph. " +
      "Use list 'retainer' only for terms that apply to an ongoing retainer.",
    input_schema: {
      type: "object",
      properties: {
        heading: { type: "string" },
        body: { type: "string" },
        list: {
          type: "string",
          enum: ["standard", "retainer"],
          description: "Which list to add to. Defaults to standard.",
        },
      },
      required: ["heading", "body"],
    },
  },
  {
    name: "update_term",
    description:
      "Rewrite an existing term, identified by its position in the list (0 is the first). " +
      "Use this to reword or correct a term rather than adding a second one saying something similar.",
    input_schema: {
      type: "object",
      properties: {
        expect: EXPECT,
        index: { type: "integer", description: "Zero-based position in that list." },
        heading: { type: "string", description: "New heading. Omit to leave unchanged." },
        body: { type: "string", description: "New body. Omit to leave unchanged." },
        list: { type: "string", enum: ["standard", "retainer"], description: "Defaults to standard." },
      },
      required: ["index"],
    },
  },
  {
    name: "remove_term",
    description: "Delete a term by its position in the list.",
    input_schema: {
      type: "object",
      properties: {
        expect: EXPECT,
        index: { type: "integer" },
        list: { type: "string", enum: ["standard", "retainer"], description: "Defaults to standard." },
      },
      required: ["index"],
    },
  },
  {
    name: "toggle_section",
    description: "Show or hide a whole section of the proposal.",
    input_schema: {
      type: "object",
      properties: {
        section: { type: "string", enum: SECTIONS },
        on: { type: "boolean", description: "true to include the section, false to leave it out." },
      },
      required: ["section", "on"],
    },
  },
  {
    name: "toggle_custom_section",
    description: "Show or hide a bespoke section, by its position in custom_sections.",
    input_schema: {
      type: "object",
      properties: {
        expect: EXPECT,
        index: { type: "integer" },
        on: { type: "boolean" },
      },
      required: ["index", "on"],
    },
  },
  {
    name: "set_page_break",
    description:
      "Make a section start on a fresh page, or stop it doing so. Use when asked to keep something " +
      "together or to give a section a page of its own — never to fix spacing or appearance.",
    input_schema: {
      type: "object",
      properties: {
        section: { type: "string", description: "A section id from SECTIONS, or a bespoke section's exact title." },
        on: { type: "boolean" },
      },
      required: ["section", "on"],
    },
  },
  {
    name: "move_section",
    description:
      "Move a section to a different position in the running order. Positions are zero-based and " +
      "count every section in section_order, switched on or not.",
    input_schema: {
      type: "object",
      properties: {
        section: { type: "string", description: "A section id, or a bespoke section's exact title." },
        to_index: { type: "integer", description: "Zero-based position to move it to." },
      },
      required: ["section", "to_index"],
    },
  },
  {
    name: "move_item",
    description:
      "Reorder one entry within a list — key aspects, terms, quote rows, cost explanations. " +
      "Use when asked to put something first, last, or above or below something else.",
    input_schema: {
      type: "object",
      properties: {
        list: { type: "string", enum: LISTS },
        from: { type: "integer", description: "The entry's current zero-based position." },
        to: { type: "integer", description: "Where it should end up, zero-based." },
      },
      required: ["list", "from", "to"],
    },
  },
  {
    name: "set_option",
    description:
      "Switch one of the panel's on/off settings. ad_hoc_column is the Ad Hoc comparison column on " +
      "the retainer table; quote_day_columns shows day rates and days on the Project Quote; " +
      "equal_option_columns keeps the Quote Options columns the same width; retainer_terms appends " +
      "the retainer-specific terms.",
    input_schema: {
      type: "object",
      properties: {
        option: { type: "string", enum: OPTIONS },
        on: { type: "boolean" },
      },
      required: ["option", "on"],
    },
  },
  {
    name: "add_retainer_tier",
    description: "Add a column to Monthly Retainer Options: a number of videos per month at a monthly price.",
    input_schema: {
      type: "object",
      properties: {
        videos_per_month: { type: "number" },
        monthly_price: { type: "number" },
      },
      required: ["videos_per_month", "monthly_price"],
    },
  },
  {
    name: "remove_retainer_tier",
    description: "Delete a Monthly Retainer Options column by its position (0 is the left-most).",
    input_schema: {
      type: "object",
      properties: { index: { type: "integer" } },
      required: ["index"],
    },
  },
  {
    name: "toggle_option_column",
    description:
      "Add or remove a Quote Options column. Columns are rungs on a fixed budget-to-premium ladder " +
      "and always print in that order; up to four fit across the page. Removing one leaves the " +
      "figures typed against it, so putting it back restores them.",
    input_schema: {
      type: "object",
      properties: {
        tier: { type: "string", enum: TIERS, description: "The ladder rung, not the printed title." },
        on: { type: "boolean" },
      },
      required: ["tier", "on"],
    },
  },
  {
    name: "set_option_column_title",
    description:
      "Change the title printed above a Quote Options column, e.g. print the Enhanced column as " +
      "'Priority'. The column keeps its rung, its figures and its place in the order. Send an empty " +
      "title to go back to the rung's own name.",
    input_schema: {
      type: "object",
      properties: {
        tier: { type: "string", enum: TIERS, description: "The ladder rung, as shown in quote_options_columns." },
        title: { type: "string", description: "What to print above it. Empty string restores the default." },
      },
      required: ["tier", "title"],
    },
  },
  {
    name: "set_option_column_total",
    description:
      "Override a Quote Options column's total, or clear the override so it goes back to adding up " +
      "the prices in that column. Only set one when asked for a figure that is not the sum.",
    input_schema: {
      type: "object",
      properties: {
        tier: { type: "string", enum: TIERS },
        total: { type: ["number", "null"], description: "The total to show, or null to auto-sum again." },
      },
      required: ["tier", "total"],
    },
  },
  {
    name: "set_price_per_video",
    description:
      "Control the price-per-video row under the Quote Options total. It divides each column's " +
      "total (after any discount) by the number of videos that column includes. A column with no " +
      "number shows a dash, and the row is hidden entirely if no column has one.",
    input_schema: {
      type: "object",
      properties: {
        on: { type: "boolean", description: "Show or hide the row. Omit to leave as is." },
        videos: {
          type: "object",
          description: "Videos included per column, keyed by the column name from quote_options_columns. Send null to clear one.",
          additionalProperties: { type: ["number", "null"] },
        },
        label: { type: "string", description: "Row label. Defaults to 'Price per video'. Omit to leave as is." },
      },
    },
  },
  {
    name: "set_discount",
    description:
      "Set the discount applied to a pricing table's total. Type 'gbp' takes that many pounds off " +
      "each column; 'pct' takes that percentage off. An amount of 0 removes the discount row.",
    input_schema: {
      type: "object",
      properties: {
        section: { type: "string", enum: ["quote", "options"] },
        amount: { type: "number", description: "Pounds, or percent when type is 'pct'. 0 removes it." },
        type: { type: "string", enum: ["gbp", "pct"] },
        label: { type: "string", description: "Row label. Defaults to 'Discount'. Omit to leave as is." },
      },
      required: ["section", "amount"],
    },
  },
];

const SYSTEM = `You are the editing assistant built into the proposal builder used by Jack Gilbey of
Engels Productions, a UK video production company. The user speaks or types a request and you carry it out
by calling tools that change the proposal.

THE RULE THAT MATTERS MOST: the proposal's visual design is locked. You never write HTML, CSS, markup or
layout of any kind, and you never describe how something should look. You only put content into the
components that already exist, using the tools. There is no tool that changes the design, and that is
deliberate — if a request can only be satisfied by changing the design, say so plainly instead.

Bulleted points are presented in this proposal as lines in the Key Aspects callout box: a bold label
followed by a sentence. When asked for bullet points, call add_key_aspect once per point. Do not try to
write dashes, asterisks or numbered lists into a paragraph — that is not how this document sets out lists.

The one exception is the text of a cost explanation, which may set out points or a worked example
beneath a pricing table. There, two line prefixes are understood:
  "- point"            renders as a bullet
  "| Videos | Rate |"  renders as a table row, the first such line being the heading row
Put each bullet or row on its own line and keep ordinary prose on separate lines above or below them.
A worked example is the one place a table belongs outside the pricing tables themselves — use it when
the user wants to show how a figure is arrived at, and keep it to a few short rows. These are plain-text
conventions the builder understands, not markup — never use them in any other field, and never write
bullets or tables any other way.

The bottom row of each pricing table reads "Total Investment" by default and can be renamed with
set_field: project_quote_total_label and quote_options_total_label. Only change it when asked.

The Quote Options table is a fixed budget-to-premium ladder — Essential, Standard, Enhanced, Premium,
Premium+ — of which up to four columns show at once, always in that order. A column is always
identified by its rung, never by what it prints: quote_options_columns gives you both, as "tier" and
"name". Retitling a column with set_option_column_title changes only the printed name; its figures,
its total and its place in the order are untouched. Under the total there can be a price-per-video
row (set_price_per_video), which divides each column's discounted total by the videos that column
includes. Both tables take a discount through set_discount.

You can also arrange the document: toggle_section and toggle_custom_section include or drop a section,
move_section and move_item reorder, set_page_break starts a section on a fresh page, and set_option
covers the panel's remaining on/off switches. Use these when the user asks for them. They change what
is in the document and in what order — never reach for them to adjust how something looks, and never
add a page break to fix spacing.

A bespoke section is built from blocks: paragraphs, sub-headings, bullets, tables, callout boxes and
photos. You write its content as plain text and the builder turns it into those blocks — "## " for a
sub-heading, "- " for a bullet, "| a | b |" for a table row. Photos and callout boxes have no text
form: you cannot add or change them, they are added by the user in the panel, and an edit you make
leaves them untouched. Say so plainly if asked to put a picture in one.

Writing style, which you must match exactly:
- British English spelling: optimise, colour, programme, specialise, organise.
- Considered, premium, quietly confident. No filler, no hype, no exclamation marks, no emoji.
- Never use marketing cliches like "elevate", "unlock", "seamless", "cutting-edge", "bespoke solutions".
- Prices are pounds. Engels Productions is NOT VAT registered — never write anything implying VAT.
- Match the length and rhythm of the copy already in the proposal.

There are two separate pricing tables and only one is usually switched on. Project Quote is a
one-off breakdown with day rates and days (add_quote_item). Quote Options is a comparison with a
column per tier (add_option_row). Before touching either, check sections_included: if the user
asks for "the quote table", they mean whichever one is currently included. Adding to a section
listed in sections_hidden puts the content somewhere they cannot see — if that is genuinely what
they want, call toggle_section to switch it on in the same turn, and say you have done so.

Key Terms & Conditions holds two lists: the standard terms, and retainer-specific terms that
only print when retainer_terms_included is true. When asked to change wording that already
exists, call update_term on the entry rather than adding a near-duplicate.

STAY INSIDE WHAT WAS ASKED. This is the thing you most often get wrong, and it is the thing the user
most notices. The proposal is written and checked by hand; anything you touch that you were not asked
to touch is damage, even when your version reads better.
- Change only what the request actually names. Everything else in the proposal stays byte-for-byte
  as it is, including copy you consider weak, inconsistent or wrongly ordered.
- When the user points at one thing — "the second key aspect", "the drone row", "the Enhanced column",
  "the payment terms" — every tool call you make in that turn addresses that one thing. Do not tidy
  its neighbours, do not restate a nearby paragraph, do not renumber or reorder anything around it.
- If a request would read as a whole-document instruction but the user has named a section, treat the
  section as the boundary. "Make it shorter" after naming the About section means the About body only.
- Wanting to fix something else you noticed is not permission to fix it. Mention it in your sentence
  to the user and leave it alone.
- One idea, one tool call. Rewriting a whole list because one entry was wrong is the classic mistake:
  call update_* on the entry that is wrong and leave its siblings untouched.
- Only when the request is genuinely document-wide — a client rename, a change of tone throughout, a
  proofread — do you touch several sections at once.

BEFORE EVERY UPDATE OR REMOVAL, name what you expect to be there. Each list entry in the state you are
given carries its own "index" — use it rather than counting, and send the entry's current heading,
label or category as "expect". If it does not match, the builder refuses the change and tells the user,
which is the intended outcome: nothing silently rewritten in the wrong place. An entry whose index you
cannot establish is one you do not touch — say so instead.

How to work:
- You are given the proposal's current contents. Read it before acting so your additions fit what is there.
- When the user says "update", "change", "reword" or "fix" something that already exists, use the
  update_* tool for that item. Only add a new entry when they are genuinely asking for one more.
- Make every change the request implies, in one go — several tool calls in one turn is normal and
  expected, as long as every one of them is inside what was asked for.
- Positions in lists are zero-based and refer to the state you were given.
- If the request is ambiguous in a way that changes what you would write, make the reasonable choice and
  say which way you went. Only ask when you genuinely cannot proceed.
- Alongside your tool calls, write one short sentence for the user saying what you changed. No preamble,
  no restating the request, no bulleted summary of your own work.`;

// The spellcheck button runs the same tools, under instructions that only allow corrections.
// It is deliberately narrow: a proposal that has been written carefully must come back reading
// exactly as it did, minus the mistakes.
const PROOFREAD = `${SYSTEM}

THIS TURN IS A PROOFREAD, NOT A REWRITE. Read the proposal's copy and correct only:
- misspellings and typos, including American spellings that should be British (optimize → optimise)
- grammar: subject/verb agreement, tense, plurals, a/an, missing or duplicated words
- punctuation: missing full stops, stray or missing commas, unbalanced brackets and quotes, spacing

Leave everything else exactly as it is. Do not improve phrasing, do not shorten or lengthen, and do
not adjust the tone of anything already correct. Never alter a number, price, date, percentage,
email address, phone number, URL, or the name of a person or company — a name that looks misspelled
to you is not yours to correct. Do not add or remove sections, list entries, table rows or photos,
and do not toggle anything on or off.

Call the matching update tool once for each field or entry that genuinely needs correcting, sending
its full corrected text. Call no tool for anything already correct. If the whole proposal is clean,
call no tools at all.

Then list what you changed, one correction per line, as: was → now. Keep each line to the words that
actually changed, not the whole sentence. If you changed nothing, say so in one short sentence.`;

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Use POST." });
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({
      error: "The AI assistant is not configured: ANTHROPIC_API_KEY is not set on this deployment.",
    });
  }

  const { instruction, state, mode } = req.body || {};
  const proofread = mode === "proofread";
  if (!proofread && (typeof instruction !== "string" || !instruction.trim())) {
    return res.status(400).json({ error: "No instruction given." });
  }

  try {
    const response = await client.messages.create({
      model: "claude-opus-5",
      max_tokens: 16000,
      // leave adaptive thinking on: with thinking disabled this model can write a tool call
      // into its visible text instead of calling the tool, which would silently do nothing
      thinking: { type: "adaptive" },
      output_config: { effort: "medium" },
      system: proofread ? PROOFREAD : SYSTEM,
      tools: TOOLS,
      messages: [
        {
          role: "user",
          content:
            "Here is the proposal as it currently stands:\n\n" +
            "```json\n" + JSON.stringify(state, null, 1) + "\n```\n\n" +
            (proofread
              ? "Proofread it and correct any spelling, grammar or punctuation mistakes."
              : "Do this:\n" + instruction.trim()),
        },
      ],
    });

    if (response.stop_reason === "refusal") {
      return res.status(200).json({ message: "I can't help with that one.", actions: [] });
    }

    const actions = [];
    let message = "";
    for (const block of response.content) {
      if (block.type === "tool_use") actions.push({ tool: block.name, input: block.input });
      else if (block.type === "text" && block.text.trim()) message += block.text;
    }

    return res.status(200).json({ message: message.trim(), actions });
  } catch (err) {
    const status = err?.status;
    // the SDK's err.message is the raw JSON envelope — dig out the sentence meant for a human
    const detail = err?.error?.error?.message || err?.message || "";
    console.error("assist failed:", status, detail);

    if (status === 401) return res.status(500).json({ error: "The API key on this deployment was rejected." });
    if (status === 429) return res.status(429).json({ error: "Rate limited by the API. Try again shortly." });
    if (/credit balance/i.test(detail)) {
      return res.status(402).json({
        error: "The Anthropic account has no credit. Add credit under Plans & Billing at console.anthropic.com, then try again.",
      });
    }
    if (status === 400) return res.status(400).json({ error: "The API rejected the request: " + detail });
    return res.status(502).json({ error: detail || "The assistant could not be reached." });
  }
}
