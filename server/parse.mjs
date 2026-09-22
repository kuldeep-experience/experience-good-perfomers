import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import { AudienceFilter, SUBSCRIPTION_STATES } from './filter.mjs'
import { DraftBatch, PARTICIPANT_TYPES } from './draft.mjs'

const AUDIENCE_SYSTEM = `You turn a marketer's plain-English description of an audience into a filter object.

You are filling in a form. You never write SQL — separate code compiles your
filter into a query, and that code always excludes people who have withheld
consent or unsubscribed. Do not try to express consent rules; they are not yours.

The data is professionals on a reviews platform. Available columns:
  state (two-letter code), city, industry (Real Estate | Mortgage | Insurance)
  subscription_status (${SUBSCRIPTION_STATES.join(' | ')})
  is_pro (boolean — the profile has purchased a subscription)
  joined_at, last_login_at, srs_score (search rank score, roughly 40-800)
  review_count, avg_rating (1-5), last review date, and whether reviews were replied to

Rules:
- Set every field. Use null for anything the request does not mention.
- "hasn't replied" / "never responded" is about reviews with no reply. If the
  request scopes it to a period ("got a review in the last 90 days but never
  replied"), use unreplied_review_within_days. If it has no period, use
  has_unreplied_reviews.
- "no reviews at all" is has_reviews: false — not min_reviews: 0.
- "subscribers" / "paying" means subscription_status ["active","trialing"].
  "lapsed" or "churned" means ["canceled","past_due"].
- "PRO" refers to is_pro.
- Convert relative dates against today's date, given below, and emit ISO dates
  for joined_after / joined_before. "this year" starts on January 1.
- Only set limit when the request asks for a specific number ("top 100").

Reply with the filter object only.`

const DRAFT_SYSTEM = `You read text a user pasted — an email, a spreadsheet row, a CRM export, a
sentence — and turn it into one survey recipient per person mentioned.

You are filling in a form, the same one a user would type by hand. You do not
send anything. Separate code checks every draft against the campaign's rules
and a person approves it before a single email goes out.

Fields:
  recipient_first_name, recipient_last_name
  email, contact_number
  transaction_id      the reference for the deal/stay/loan (e.g. TXN-88213, #4471)
  transaction_type    e.g. Purchase, Refinance, Listing, Rental
  transaction_date    ISO date, YYYY-MM-DD
  participant_type    exactly one of: ${PARTICIPANT_TYPES.join(', ')}
  city, state         where the transaction happened; state as a two-letter code

Rules:
- One object in "drafts" per person. If the text lists ten people, return ten.
- NEVER invent a value. If the text does not give a field, set it to null.
  A missing field is caught downstream and is safe. A guessed email is not.
- Do not reuse one person's email, phone or transaction id for another person.
- Convert relative dates ("yesterday", "last Tuesday", "closed on the 3rd")
  against today's date, given below.
- Map wording to participant_type: buyer -> BUYER, seller -> SELLER,
  borrower -> BORROWER, co-borrower / cosigner -> COBORROWER,
  guest / customer / client -> Customer1, second guest -> Customer2.
  If the text does not say, use null rather than assuming.
- Expand two-word state names to the code: "Texas" -> "TX".
- transaction_type must be a word the text actually uses ("purchase",
  "refinance", "listing"). Do not infer it from the kind of deal: a borrower
  with a loan number is not evidence of "Loan", and a hotel guest is not
  evidence of "Rental". If the text does not name one, use null.

Reply with the drafts object only.`

const withDate = (base) => `${base}\n\nToday's date is ${new Date().toISOString().slice(0, 10)}.`

/**
 * One task = one prompt plus one JSON Schema, handed unchanged to every
 * provider, so a provider comparison measures the model and not two different
 * contracts.
 */
const task = (name, base, zod) => ({
  name,
  system: () => withDate(base),
  format: zodOutputFormat(zod),
  schema: zodOutputFormat(zod).schema,
})

export const TASKS = {
  audience: task('audience_filter', AUDIENCE_SYSTEM, AudienceFilter),
  drafts: task('survey_drafts', DRAFT_SYSTEM, DraftBatch),
}

async function viaClaude(prompt, t) {
  const response = await new Anthropic().messages.parse({
    model: process.env.ANTHROPIC_MODEL || 'claude-opus-5',
    max_tokens: 16000,
    system: t.system(),
    messages: [{ role: 'user', content: prompt }],
    output_config: {
      format: t.format,
      effort: process.env.PARSE_EFFORT || 'low',
    },
  })
  if (response.stop_reason === 'refusal') {
    throw new Error(`Model declined: ${response.stop_details?.category ?? 'unknown'}`)
  }
  if (!response.parsed_output) throw new Error('No output in the response.')
  return response.parsed_output
}

// xAI and OpenRouter both expose the OpenAI chat-completions shape, so they
// share one implementation and differ only by endpoint, key and model. A whole
// SDK to POST one JSON body would not earn its place.
function openAICompatible({
  label,
  url,
  envKey,
  modelEnv,
  defaultModel,
  extraHeaders = {},
  extraBody = {},
}) {
  return async function run(prompt, t) {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${process.env[envKey]}`,
        'content-type': 'application/json',
        ...extraHeaders,
      },
      body: JSON.stringify({
        model: process.env[modelEnv] || defaultModel,
        // The output is one small JSON object. Without a cap, providers assume
        // the model's full ceiling (65k on some) and reserve credit for it,
        // which fails on a limited key for a request that costs cents.
        max_tokens: Number(process.env.MAX_OUTPUT_TOKENS) || 4096,
        messages: [
          { role: 'system', content: t.system() },
          { role: 'user', content: prompt },
        ],
        response_format: {
          type: 'json_schema',
          json_schema: { name: t.name, strict: true, schema: t.schema },
        },
        ...extraBody,
      }),
    })

    const body = await res.json().catch(() => null)
    // OpenRouter can return an error with HTTP 200, so check the body too.
    const failure = body?.error
    if (!res.ok || failure) {
      const detail = failure?.message || failure || body?.message || res.statusText
      throw new Error(`${label} ${res.status}: ${detail}`)
    }

    const choice = body?.choices?.[0]
    // A truncated response is otherwise indistinguishable from a bad model:
    // you get half a JSON object and a parse error that blames the wrong thing.
    if (choice?.finish_reason === 'length') {
      throw new Error(
        `${label} hit the output cap before finishing. Raise MAX_OUTPUT_TOKENS.`,
      )
    }
    const content = choice?.message?.content
    if (!content)
      throw new Error(
        `${label} returned nothing. Does ${process.env[modelEnv] || defaultModel} support structured outputs?`,
      )
    try {
      return JSON.parse(content)
    } catch {
      throw new Error(`${label} returned content that was not valid JSON.`)
    }
  }
}

/**
 * OpenRouter is one key for many vendors. These ids were read from
 * openrouter.ai/api/v1/models and filtered to ones advertising
 * structured_outputs; override any of them with OPENROUTER_MODEL_<NAME>
 * when the catalogue moves.
 */
const OPENROUTER_MODELS = {
  openrouter: { label: 'OpenRouter', model: 'openrouter/free' },
}

const throughOpenRouter = (name, defaultModel) =>
  openAICompatible({
    label: `OpenRouter/${name}`,
    url: 'https://openrouter.ai/api/v1/chat/completions',
    envKey: 'OPENROUTER_API_KEY',
    modelEnv: `OPENROUTER_MODEL_${name.toUpperCase()}`,
    defaultModel,
    extraHeaders: { 'X-Title': 'Audience Builder' },
    // Route only to backends that actually honour response_format. Without it
    // OpenRouter may fall through to one that ignores the schema and answers
    // in prose, which looks like a model failure but isn't.
    extraBody: { provider: { require_parameters: true } },
  })

export const PROVIDERS = {
  ...Object.fromEntries(
    Object.entries(OPENROUTER_MODELS).map(([name, { label, model }]) => [
      `or/${name}`,
      {
        label,
        group: 'OpenRouter',
        envKey: 'OPENROUTER_API_KEY',
        model,
        run: throughOpenRouter(name, model),
      },
    ]),
  ),
  ...(process.env.ANTHROPIC_API_KEY
    ? { claude: { label: 'Claude', group: 'Anthropic', envKey: 'ANTHROPIC_API_KEY', model: process.env.ANTHROPIC_MODEL || 'claude-opus-5', run: viaClaude } }
    : {}),
}

/** Provider names that actually have a key set. */
export const availableProviders = () =>
  Object.keys(PROVIDERS).filter((name) => process.env[PROVIDERS[name].envKey])

export function resolveProvider(requested) {
  const want = requested || process.env.PARSER_PROVIDER
  if (want) {
    const p = PROVIDERS[want]
    if (!p) throw new Error(`Unknown provider "${want}". Use one of: ${Object.keys(PROVIDERS).join(', ')}`)
    if (!process.env[p.envKey]) throw new Error(`${p.label} needs ${p.envKey} in your .env`)
    return want
  }
  const [first] = availableProviders()
  if (!first) {
    throw new Error(
      'No model provider configured. Set ANTHROPIC_API_KEY, XAI_API_KEY or OPENROUTER_API_KEY in .env.',
    )
  }
  return first
}

const run = async (prompt, t, requested) => {
  const provider = resolveProvider(requested)
  return { provider, raw: await PROVIDERS[provider].run(prompt, t) }
}

/**
 * English -> AudienceFilter, via whichever provider is asked for.
 * Whatever comes back is schema-validated before it reaches the compiler —
 * model output is input, not instructions.
 */
export async function parsePrompt(prompt, requested) {
  const { provider, raw } = await run(prompt, TASKS.audience, requested)
  return { provider, filter: AudienceFilter.parse(raw) }
}

/** Pasted text -> survey drafts. Validated here, then validated again in code. */
export async function parseDrafts(text, requested) {
  const { provider, raw } = await run(text, TASKS.drafts, requested)
  return { provider, drafts: DraftBatch.parse(raw).drafts }
}
