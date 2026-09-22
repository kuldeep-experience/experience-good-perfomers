# Campaign agent

Two prototypes against **Campaigns (discipline 06)**, sharing one design and one
guardrail.

1. **Send surveys** — paste anything that names recipients (an email, a
   spreadsheet, a sentence). The agent fills in the Send Manual Survey form,
   checks every draft against the campaign's set conditions, and a person
   approves the send.
2. **Audience builder** — describe an audience in plain English; the system
   compiles it to a query and shows the count, a sample and the SQL.

Both work the same way: **the model fills in a form, code does everything else.**

---

## Send surveys

### The problem, from the product

In XMP, sending a survey by hand is Campaigns → ⋮ → Send Manual Survey, then ten
fields per recipient: first name, last name, email, contact number, transaction
id, transaction type, transaction date, participant type, city, state. One
recipient at a time.

Under Participant Type the drawer says:

> Please make sure the source type in set conditions are updated correctly.

That sentence is the whole opportunity. A survey can pass every field-level
check in the form and still never reach anyone, because whether it reaches
anyone depends on the campaign's **set conditions**, which live on a different
screen. The form accepts it. Nothing errors. The transaction quietly lands in
Uncollected Transactions.

### What the agent does

Three things, in order of how much they are worth:

1. **Validate.** Cross-check each draft against the selected campaign: allowed
   participant types, allowed transaction types, source type, expiry window,
   cooldown, the unsubscribe and bounce list, and what has already been sent.
   This is `server/draft.mjs`, it is ordinary code, and **it is valuable with
   the model switched off entirely.**
2. **Extract.** Turn pasted text into filled forms. This is the part a dropdown
   cannot do, and the only part that needs a model.
3. **Batch.** The drawer is one recipient at a time. A paste is forty.

### Preview, approve, send

Sending is two stages on purpose.

**Details** — the ten form fields, editable, with every blocker and warning
against the campaign's rules. Editing a field re-checks it without another model
call.

**Preview** — what will actually land in the inbox: the From address, the
subject with the recipient's name filled in, the body, the rating control, the
expiry date and the reminder count. Each one has its own approve checkbox, and
only approved, unblocked drafts are sent.

The message is assembled by `renderSurvey()` from the campaign's own template.
Substitution is a fixed whitelist — `{{first_name}}`, `{{transaction_id}}`,
`{{last_name}}`, `{{city}}` — filled in by code. **The model writes no part of
what the customer reads**, so no prompt can change the message, and the preview
is the message rather than an impression of it.

The deck puts the send path first for this reason: *"Parity on the send path
first — it has to be trustworthy — then the conversational builder behind a flag
for internal users."*

### The line that is not crossed

**The agent drafts. A person sends.** An email to a customer cannot be recalled,
so nothing is written until someone presses the button — and `/api/send`
re-validates every draft from scratch before it writes, because the verdict on
screen is a display, not a decision.

The agent also never creates a campaign. If an existing campaign fits, using it
is correct; auto-creating near-duplicates gives you fifty campaigns and
analytics that do not roll up.

### What it catches

| Check | Why the form alone misses it |
|---|---|
| Participant type vs. set conditions | The conditions are on another screen |
| Transaction type vs. set conditions | Same |
| Survey older than the campaign's expiry | Expires on arrival, silently |
| Unsubscribed or bounced address | Not shown in the drawer |
| Same participant on the same transaction | Duplicate survey to one person |
| Same person inside the cooldown window | Survey fatigue |
| Paused campaign | Accepts input, sends nothing |

A co-borrower shares a loan number with the borrower, so "already surveyed" is
keyed on transaction **and** participant — not transaction alone. That
distinction is in `sendKey()`, and it is the kind of thing a naive duplicate
check gets wrong.

### Run the checks

```bash
npm run check          # the validator, pure + against the seeded database
npm run eval:extract   # the extractor, against hand-written expected forms
```

`npm run check` needs no API key and no network. That is the point: the
expensive, non-deterministic part is one step, and the part that decides whether
an email goes out is not it.

---

## Audience builder

A marketer describes an audience in plain English. The system works out what
they meant, runs it against the database, and shows the count, a sample, and
the query it generated. Approving saves the audience. Nothing sends.

## Run it

```bash
npm install
cp .env.example .env      # set at least one provider key
npm run dev
```

The API runs inside Vite's dev-server middleware, so there's no second process
and the API key never reaches the browser. The database is
[PGlite](https://pglite.dev) — real Postgres, in process, seeded at startup from
`sql/schema.sql`. No external database to provision.

## The design decision that matters

**The model never writes SQL.** It fills in a form:

```json
{ "states": ["FL"], "unreplied_review_within_days": 90, "is_pro": null, ... }
```

`server/filter.mjs` compiles that form into a parameterised query. Three things
follow, none of which are true if you let a model emit SQL directly:

1. **It cannot write anything destructive** — it has no field that expresses a
   write.
2. **Consent is guaranteed, not requested.** `consent_status = 'granted'` and
   `unsubscribed_at is null` are appended by the compiler on every query. There
   is no field the model could set to skip them, so there is no prompt that
   makes this tool email someone who opted out.
3. **It is testable.** You can check the form, not just the final row set.

The deck is blunt about why (3) and (2) matter: *"Suppression and consent is not
a place to move fast. Wrong there is a legal problem, not a bug."*

The model still does the hard part — mapping "never replied to it" onto absence,
"lapsed" onto `canceled`/`past_due`, "this year" onto a calendar boundary. Take
the model out and you're back to the two people who know the schema.

## Audiences are queries, not lists

The deck's second piece of new ground for this discipline:

> Audiences from graph queries — not static lists that go stale the next day.

Approving an audience stores `filter_json` — the query — and **not** the people
it matched. The saved-audiences table re-runs every stored filter on load and
shows the count when it was saved beside the count now.

That difference is the whole point and it is visible in one row: an audience
saved at 29 people reads 48 today, because three weeks of reviews landed. A
saved list of 29 ids would still say 29, and the campaign would be sent to a set
of people that stopped being the right answer the day after it was built.

It also means an audience survives changes underneath it. The filter says what
the marketer meant; the graph says who currently satisfies it.

## The graph boundary (discipline 08)

Campaigns' tech list ends in **Graph read**, and 08 is blunt about why:

> The graph is the platform. Twelve disciplines read from it, and any one of
> them writing to it breaks the other eleven.
>
> Schema changes originate here and nowhere else. Every other role has no DDL
> rights, deliberately.

So the split runs through the SQL:

| File | Owner | This app |
|---|---|---|
| `sql/schema.sql` | Graph (08) | **reads one view**, `campaign_professionals` |
| `sql/campaigns.sql` | Campaigns (06) | reads and writes freely |

The compiler never names a base table. Every time-relative question
("reviewed in the last 90 days") is a comparison against a column the read view
already exposes, so 08 can reshape `professionals` and `reviews` underneath
without a single filter changing.

`npm run check` asserts this rather than claiming it:

- every query `compile()` can emit begins with `select`
- none contains `insert`, `update`, `delete`, `drop`, `alter`, `create`,
  `truncate` or `grant`
- its only `from` is the read view
- no `insert`/`update`/`delete` anywhere in the server targets a table declared
  in the graph-owned file

That last check earned its place immediately: `audiences` — a table this app
writes — was sitting in the graph file, and the check failed until it moved.

## Providers

The parser is not tied to one vendor. `server/parse.mjs` dispatches by name, and
both tasks — audience filters and survey drafts — go through the same dispatch:

| Provider | Route | Default model | Key |
|---|---|---|---|
| `claude` | Anthropic SDK, `messages.parse` | `claude-opus-5` | `ANTHROPIC_API_KEY` |
| `or/openrouter` | OpenRouter | `openrouter/free` | `OPENROUTER_API_KEY` |

Add a vendor by adding a row to `OPENROUTER_MODELS` in `server/parse.mjs` — one
key covers all of them. Override any model with
`OPENROUTER_MODEL_<NAME>`; ids come from
`openrouter.ai/api/v1/models` and filtered to ones advertising structured
outputs.

xAI and OpenRouter both expose the OpenAI chat-completions shape, so they share
one `openAICompatible` implementation and differ only by endpoint, key and
model. Only Claude-direct needs its own path, because the Anthropic SDK is not
that shape. Adding a seventh provider is a row in a table.

OpenRouter requests carry `provider: { require_parameters: true }` so a request
is only routed to a backend that honours `response_format`. Without it
OpenRouter can fall through to one that ignores the schema and answers in prose,
which reads like a model failure but isn't.

Every provider gets the **same system prompt and the same JSON Schema** — the
schema is generated once from the Zod definition and handed to each — so a
comparison measures the model rather than two different contracts. Whatever
comes back is validated against that schema before it can reach the compiler:
model output is input, not instructions.

This is also why the guardrail design matters more than the model choice.
Consent is enforced in `compile()`, so swapping models cannot weaken it. The
filter contract is the product; the model is a replaceable part.

## Evals

Two suites, one per task.

```bash
npm run check          # the validator — no API key, no network, instant
npm run eval:extract   # the extractor — 8 cases, one API call each
npm run eval           # the audience parser — 12 cases, one API call each
```

### Extraction

`evals/extract-cases.mjs` pairs pasted text with the forms a careful person
would fill in from it — **including the fields that must stay empty**, because a
confidently invented email address is the one failure this tool must not have.
Scoring is per field, and drafts are paired with their expectation by email
rather than by position: two people coming back in the other order with their
details correctly paired is not a mistake.

| Case | Why it's hard |
|---|---|
| Two participants, one loan | Shared transaction id, different roles |
| Pasted spreadsheet | Four rows, no prose to lean on |
| Details missing on purpose | Everything absent must come back `null` |
| "closed yesterday" | Relative date against today |
| Contact details listed apart from names | Easy to give both people the first email |
| Nothing to survey | Must return an empty list, not invent one |

**Measured:** 7/8 perfect. Both of the original failures were the same thing —
inventing a `transaction_type` ("Rental" from a hotel guest, "Loan" from a
borrower) that the text never used. One added prompt rule fixed both, which is
the argument for having the suite at all: the failure had a shape, and the shape
was visible.

The eighth failed on an OpenRouter timeout and passes on retry. That is worth
saying plainly rather than quietly re-running: a network hiccup and a model
mistake look identical in a screenshot, and only one of them is fixable by
prompting.

### Audience parsing

```bash
npm run eval                 # all cases, default provider
npm run eval -- grok         # all cases through Grok
npm run eval -- openrouter   # all cases through OpenRouter
npm run eval -- 3 grok       # just case 3, through Grok
```

Because every provider runs the same cases against the same hand-written
references, this doubles as a **model bake-off**: run it per provider and you
have per-case pass rates on labelled data. "Claude got 11/12, Grok got 9/12, and
here are the three prompts where they disagree" is a far better artifact than
any single number — and with OpenRouter in the mix, comparing another half-dozen
models costs one env var each.

`evals/cases.mjs` pairs each English request with a **hand-written reference
query** — what someone who knows the schema would write. The runner compares the
ids the model's filter returns against the ids the reference returns and reports
exact matches, plus what was extra and what was missing.

That makes correctness a number rather than an opinion, which is the whole
reason this idea was chosen over a chat agent: a transcript is judged, a row set
is checked.

The cases deliberately concentrate on where text-to-query breaks:

| Case | Why it's hard |
|---|---|
| "no reviews at all" | absence, not `min_reviews: 0` |
| "got a review in 90 days but never replied" | a window over a negative condition |
| "hasn't logged in for 60 days" | must include never-logged-in (`NULL`) |
| "joined this year" | calendar boundary, not "365 days ago" |
| "fewer than 5 reviews" | exclusive bound |

Each run writes `evals/results/<provider>-<effort>-<timestamp>.json`, so pass
rate across prompt versions and across providers is a trend you can show rather
than a claim you make.

`PARSE_EFFORT` (default `low`, Claude only) sets reasoning depth. Raising it and
re-running the evals gives you a measured accuracy-vs-latency curve for free —
the runner prints average ms per case and tags the results file with provider
and effort.

Each case is one API call, so a full run is 12.

**Measured:** Gemini 3.8 Flash via OpenRouter scores **11/12**, averaging ~6.7s
per case. The twelfth ("everyone in Georgia or Washington") fails
intermittently and passes on retry — the response occasionally arrives
truncated rather than the model misreading the request. `MAX_OUTPUT_TOKENS`
(default 4096) caps it; a truncated response is now reported as such instead of
surfacing as a JSON parse error.

That cap matters for more than truncation: without it, providers reserve credit
against the model's full output ceiling — 65k on Gemini — and a limited key gets
a 402 for a request that actually costs cents.

## Seed data

420 professionals across 5 states and 3 industries, with reviews, replies,
subscription states, logins, and consent. Volume per professional is derived
arithmetically rather than from `random()` — a `random()` in that join's `WHERE`
is evaluated once per professional, giving everyone either 0 or 24 reviews, and
the eval references need a stable corpus anyway.

## Not built

Real sending (a send writes a row, it does not deliver mail), scheduling,
conversational refinement ("actually exclude Florida"), audience freshness
tracking, auth, and per-account condition fields loaded from a customer's own
integration mapping. All useful; none of them prove the idea.

The database also resets on every server start. That's fine for a demo and
wrong for anything else — point `server/db.mjs` at a real Postgres to fix it.
