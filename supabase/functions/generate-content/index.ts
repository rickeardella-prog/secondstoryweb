// generate-content: George-only endpoint. Two-step pipeline:
//   1. Claude Opus 4.8 + web search researches and writes the Field Notes blog post.
//   2. Claude Sonnet 5 derives the LinkedIn post, X posts, title, slug, and
//      excerpt from the finished blog, so the socials always match the post.
// Stores the draft in content_items and returns the new row.
//
// This is a reference copy of the deployed Supabase edge function
// (project SecondStoryWeb). Deployed version is the source of truth.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import Anthropic from "npm:@anthropic-ai/sdk";

const OWNER_EMAIL = "rick.e.ardella@gmail.com";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const serviceClient = () =>
  createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

// verify_jwt only proves a valid project JWT — enforce that the caller is George.
async function requireGeorge(req: Request): Promise<Response | null> {
  const authHeader = req.headers.get("Authorization") ?? "";
  const userClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  );
  const { data, error } = await userClient.auth.getUser();
  if (error || !data.user || data.user.email !== OWNER_EMAIL) {
    return json({ error: "Not authorized" }, 403);
  }
  return null;
}

// Step 2 returns everything except blog_markdown, which comes verbatim from step 1.
const OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string", description: "Blog post title, plain text, no quotes around it" },
    slug: { type: "string", description: "URL slug: lowercase, words separated by hyphens, max 60 chars, no other punctuation" },
    excerpt: { type: "string", description: "1-2 sentence summary for the blog list page" },
    linkedin_post: { type: "string", description: "LinkedIn post, plain text with line breaks" },
    x_posts: {
      type: "array",
      items: { type: "string" },
      description: "Either a single post, or a 3-6 post thread. Each item must be 270 characters or fewer.",
    },
  },
  required: ["title", "slug", "excerpt", "linkedin_post", "x_posts"],
  additionalProperties: false,
} as const;

const VOICE = `Who George is on the page (George Ricciardella, founder of Second Story Consulting, a nonprofit fundraising consultancy):
- Warm, direct, practical. A seasoned fundraiser talking to a peer over coffee. Never corporate, never jargon-heavy.
- First person singular ("I"), grounded in field experience. He tells you what happened, not what "leaders should do."
- Comfortable admitting doubt, changed minds, and his own flaws. Some of his best lines are confessions.
- Audience: nonprofit executive directors and development staff who feel stuck.
- Brand language, used sparingly and only where it fits naturally: every nonprofit deserves a "second story" (a next chapter); fundraising programs get "rebuilt"; donors are people, not line items; listen / connect / suggest.

Calibrate to these real excerpts of George's own writing:

Excerpt 1:
"One of the hardest leadership lessons I've learned is that conviction and stubbornness can look almost identical. I've walked into meetings convinced I had the right answer and walked out realizing my team had been right all along. Those moments sting. They also build trust. People don't expect leaders to be right every time. They expect leaders to listen when the evidence changes. Sometimes the strongest sentence a leader can say is: 'I think you're right.'"

Excerpt 2:
"A few years ago, I would have told you that growth was always the goal. We need more donors, bigger events, more participants, more of everything. Now I'm not so sure. A flaw that I have is that I can ideate and pursue quickly. I can move towards the new big thing, while the pot on the stove hasn't quite boiled yet. Sometimes bigger is not better, but better always is."

Notice what he does: short paragraphs, sometimes one sentence. Plain words. A specific admission or memory doing the work that an abstraction would do in worse writing. A quiet closing line instead of a summary.

Do not sound like AI. This matters more than polish. Readers now recognize machine writing instantly, and one tell undermines everything. Specifically:

Banned words (in their buzzword or figurative senses): delve, tapestry, landscape, leverage, robust, foster, harness, streamline, pivotal, crucial, testament, underscore, showcase, vibrant, intricate, seamless, transformative, empower, elevate, unlock, unpack, navigate, realm, journey, boasts, game-changer, game changer, synergy, ecosystem, invaluable, actionable, resonate, deep dive, dive in.

Banned phrases and openers: "In today's ... world" (or landscape, environment, climate), "at its core", "Here's the thing", "Let that sink in", "Read that again", "The truth is", "The reality is", "at the end of the day", "moving the needle", "In conclusion", "Ultimately".

Banned patterns:
- Negative parallelism as a formula: "It's not X. It's Y.", "not just X, but Y", "X isn't about Y. It's about Z." At most once per piece, and only when nothing simpler says it.
- The rule of three: three parallel adjectives, clauses, or examples in a row. One strong specific beats three thin ones.
- Em dashes: at most two per piece. Use periods and commas instead.
- Bullet lists with bolded lead-ins. Avoid listicle structure entirely; write prose.
- Dressed-up verbs where "is" or "has" would do: "serves as", "represents", "stands as", "marks", "boasts".
- Grand or inspirational endings. End the way George does: one quiet, specific line, sometimes a small reversal.
- Uniform paragraphs. Vary sentence and paragraph length; if every paragraph is the same size it reads machine-made.
- Manufactured specificity. Keep the source's concrete details (numbers, moments, names of feelings, small failures). If the source doesn't give you a detail, write plainly around the gap. Never invent one.
- No emojis. No hashtags. Anywhere.`;

const BLOG_SYSTEM = `You write blog posts for George Ricciardella. You are given raw source material (a video transcript or a rough brain dump) and you turn it into a polished "Field Notes" blog post in George's voice.

${VOICE}

The deliverable: a Field Notes blog post, 700-1100 words of Markdown. Use a few ## subheadings in sentence case, or none if the piece flows better without them. Open with a specific moment, admission, or question from the material, not a thesis statement. Close with one practical takeaway or a gentle invitation to talk. Do not include a title or a # heading; the site renders the title separately.

Using web search:
- You have a web search tool. Use it only when it genuinely strengthens the piece: verifying a statistic George half-remembers, adding one current fact or study that supports his point, or checking that a claim is still true. Zero searches is a fine outcome for a personal story.
- The transcript is the heart of the piece. Search seasons the post; it never writes it.
- When you use a fact from search, attribute it naturally in the prose ("a 2026 Giving USA report found..."). No footnotes, no link dumps.
- Never invent statistics, and never present searched facts as George's firsthand experience.

Your final message must be ONLY the finished blog post in Markdown. No preamble, no notes about your searches, no commentary before or after the post.`;

const SOCIAL_SYSTEM = `You turn George Ricciardella's finished blog post into social content plus metadata. You are given the blog post; everything you produce must derive from it. Do not add facts, statistics, or stories that are not in the post.

${VOICE}

Deliverables:
1. title: a plain, specific blog title in George's voice. No colons-plus-buzzword constructions, no clickbait.
2. slug: lowercase-kebab-case from the title, 60 chars max.
3. excerpt: 1-2 sentences, plain and specific, that make someone want to click. Same voice rules apply.
4. linkedin_post: 150-250 words. Strong plain first line (it gets truncated in the feed). Short paragraphs, some just one sentence. End with a question or a quiet closing line. No hashtags. No emojis. Do not copy the blog's opening verbatim; find the post's sharpest idea and lead with it.
5. x_posts: ONE post if the idea is simple, or a 3-6 post thread if it has real meat. Each post 270 characters max. First post must stand alone. Write them like observations from a smart friend, not marketing copy. No hashtags. No emojis.`;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const denied = await requireGeorge(req);
  if (denied) return denied;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const sourceType = String(body.source_type ?? "");
  const sourceText = String(body.source_text ?? "").trim();
  const sourceUrl = body.source_url ? String(body.source_url) : null;

  if (!["youtube", "brain_dump", "voice"].includes(sourceType)) {
    return json({ error: "Unknown source type" }, 400);
  }
  if (sourceText.length < 40) {
    return json({ error: "That's a bit short to work with — add a few more sentences." }, 400);
  }
  if (sourceText.length > 120_000) {
    return json({ error: "That input is too long — trim it to roughly 20,000 words." }, 400);
  }

  const supabase = serviceClient();

  const { data: apiKey, error: keyError } = await supabase.rpc("get_secret", {
    secret_name: "ANTHROPIC_API_KEY",
  });
  if (keyError || !apiKey) {
    console.error("ANTHROPIC_API_KEY missing:", keyError?.message);
    return json({ error: "The Anthropic API key isn't set up yet." }, 500);
  }

  const anthropic = new Anthropic({ apiKey });

  // ---- Step 1: Opus 4.8 + web search writes the blog post ----
  let blogMarkdown = "";
  try {
    let messages: Anthropic.MessageParam[] = [
      {
        role: "user",
        content: `Source type: ${sourceType}${sourceUrl ? `\nSource URL: ${sourceUrl}` : ""}\n\nSource material:\n\n${sourceText}`,
      },
    ];
    // Server-side web search can pause long turns (stop_reason "pause_turn");
    // re-send with the assistant turn appended to let it resume.
    for (let attempt = 0; attempt < 4; attempt++) {
      const stream = anthropic.messages.stream({
        model: "claude-opus-4-8",
        max_tokens: 16000,
        thinking: { type: "adaptive" },
        system: BLOG_SYSTEM,
        tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 5 }],
        messages,
      });
      const message = await stream.finalMessage();
      if (message.stop_reason === "pause_turn") {
        messages = [...messages, { role: "assistant", content: message.content }];
        continue;
      }
      // The blog is the text after the last tool/search block (earlier text
      // blocks can be "let me check that stat" narration).
      let lastNonText = -1;
      message.content.forEach((b, i) => {
        if (b.type !== "text" && b.type !== "thinking") lastNonText = i;
      });
      blogMarkdown = message.content
        .filter((b, i): b is Anthropic.TextBlock => b.type === "text" && i > lastNonText)
        .map((b) => b.text)
        .join("")
        .trim();
      break;
    }
    if (!blogMarkdown) throw new Error("blog step produced no text");
  } catch (err) {
    console.error("blog step failed:", err instanceof Error ? err.message : err);
    return json({ error: "The writing step failed — try again in a minute." }, 502);
  }

  // ---- Step 2: Sonnet 5 derives socials + metadata from the blog ----
  let parsed: {
    title: string; slug: string; excerpt: string;
    linkedin_post: string; x_posts: string[];
  };
  try {
    const stream = anthropic.messages.stream({
      model: "claude-sonnet-5",
      max_tokens: 8000,
      system: SOCIAL_SYSTEM,
      output_config: { format: { type: "json_schema", schema: OUTPUT_SCHEMA } },
      messages: [{ role: "user", content: `The finished blog post:\n\n${blogMarkdown}` }],
    });
    const message = await stream.finalMessage();
    const textBlock = message.content.find((b) => b.type === "text") as
      | { type: "text"; text: string }
      | undefined;
    if (!textBlock) throw new Error(`no text block (stop_reason: ${message.stop_reason})`);
    parsed = JSON.parse(textBlock.text);
  } catch (err) {
    console.error("social step failed:", err instanceof Error ? err.message : err);
    return json({ error: "The blog was written but the social posts failed — try again in a minute." }, 502);
  }

  // Normalize + de-dupe the slug
  let slug = (parsed.slug || parsed.title)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  const { data: existing } = await supabase
    .from("content_items")
    .select("slug")
    .like("slug", `${slug}%`);
  if (existing?.some((r: { slug: string }) => r.slug === slug)) {
    let n = 2;
    while (existing.some((r: { slug: string }) => r.slug === `${slug}-${n}`)) n++;
    slug = `${slug}-${n}`;
  }

  const { data: item, error: insertError } = await supabase
    .from("content_items")
    .insert({
      source_type: sourceType,
      source_url: sourceUrl,
      source_text: sourceText,
      title: parsed.title,
      slug,
      excerpt: parsed.excerpt,
      blog_markdown: blogMarkdown,
      linkedin_post: parsed.linkedin_post,
      x_posts: Array.isArray(parsed.x_posts) ? parsed.x_posts : [],
      status: "draft",
    })
    .select()
    .single();

  if (insertError) {
    console.error("insert failed:", insertError.message);
    return json({ error: "Generated fine but couldn't save — try again." }, 500);
  }

  return json({ item });
});
