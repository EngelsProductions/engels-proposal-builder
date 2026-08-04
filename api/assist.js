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
];

const SECTIONS = [
  "toc", "about", "keyaspects", "includes", "portfolio", "scope",
  "quote", "options", "rates", "terms", "retainer", "next",
];

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
      "Add a cost explanation beneath a pricing table — a short bold label and a paragraph explaining " +
      "why something costs what it does or what it covers. This is the right tool for explaining an " +
      "approach, a crew choice, or what a line item includes.",
    input_schema: {
      type: "object",
      properties: {
        section: { type: "string", enum: ["quote", "options"], description: "Which pricing table it sits under." },
        label: { type: "string", description: "Short bold lead-in, e.g. 'Why four camera angles'." },
        text: { type: "string", description: "The explanation, one paragraph." },
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
        section: { type: "string", enum: ["quote", "options"] },
        index: { type: "integer", description: "Zero-based position in that section's explanation list." },
        label: { type: "string", description: "New label. Omit to leave unchanged." },
        text: { type: "string", description: "New text. Omit to leave unchanged." },
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
    name: "add_custom_section",
    description:
      "Add a bespoke section: a navy section bar with a heading, followed by body copy. " +
      "Use only when the content does not belong in an existing section.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Section heading. Rendered in capitals." },
        body: { type: "string", description: "Body copy. Blank lines separate paragraphs." },
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
      properties: { index: { type: "integer" } },
      required: ["index"],
    },
  },
  {
    name: "add_term",
    description: "Add a term to Key Terms & Conditions: a short heading and a paragraph.",
    input_schema: {
      type: "object",
      properties: {
        heading: { type: "string" },
        body: { type: "string" },
      },
      required: ["heading", "body"],
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

Writing style, which you must match exactly:
- British English spelling: optimise, colour, programme, specialise, organise.
- Considered, premium, quietly confident. No filler, no hype, no exclamation marks, no emoji.
- Never use marketing cliches like "elevate", "unlock", "seamless", "cutting-edge", "bespoke solutions".
- Prices are pounds. Engels Productions is NOT VAT registered — never write anything implying VAT.
- Match the length and rhythm of the copy already in the proposal.

How to work:
- You are given the proposal's current contents. Read it before acting so your additions fit what is there.
- Make every change the request implies, in one go — several tool calls in one turn is normal and expected.
- Positions in lists are zero-based and refer to the state you were given.
- If the request is ambiguous in a way that changes what you would write, make the reasonable choice and
  say which way you went. Only ask when you genuinely cannot proceed.
- Alongside your tool calls, write one short sentence for the user saying what you changed. No preamble,
  no restating the request, no bulleted summary of your own work.`;

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Use POST." });
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({
      error: "The AI assistant is not configured: ANTHROPIC_API_KEY is not set on this deployment.",
    });
  }

  const { instruction, state } = req.body || {};
  if (typeof instruction !== "string" || !instruction.trim()) {
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
      system: SYSTEM,
      tools: TOOLS,
      messages: [
        {
          role: "user",
          content:
            "Here is the proposal as it currently stands:\n\n" +
            "```json\n" + JSON.stringify(state, null, 1) + "\n```\n\n" +
            "Do this:\n" + instruction.trim(),
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
    if (status === 401) return res.status(500).json({ error: "The API key on this deployment was rejected." });
    if (status === 429) return res.status(429).json({ error: "Rate limited by the API. Try again shortly." });
    console.error("assist failed:", err);
    return res.status(502).json({ error: err?.message || "The assistant could not be reached." });
  }
}
