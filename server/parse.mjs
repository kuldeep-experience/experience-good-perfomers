import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import { AudienceFilter, SUBSCRIPTION_STATES } from './filter.mjs'
import { DraftBatch, PARTICIPANT_TYPES } from './draft.mjs'
import { CampaignDraft, QUESTION_TYPES } from './campaign.mjs'

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

const CAMPAIGN_SYSTEM = `You turn a plain-English description of a survey campaign into a campaign object.

You are filling in the campaign setup form a tier admin fills in by hand today.
You do not activate anything and you do not send anything. A person reads what
you produce, edits whatever they want, and presses Activate.

Fields:
  name                       short and human, what it would be called in a list
  source_type                Manual | Encompass | Salesforce | AMS360
  allowed_participant_types  any of: ${PARTICIPANT_TYPES.join(', ')}
  allowed_transaction_types  e.g. Purchase, Refinance, Listing, Rental.
                             An empty array means any transaction.
  expiry_days                days after the transaction the survey stops going out
  cooldown_days              days before the same person may be surveyed again
  reminders                  how many reminder emails, 0 to 3
  send_as                    "Sender Name <address@domain>"
  subject, intro             the email. {{first_name}} and {{transaction_id}}
                             are the only slots that exist; use them or plain text.
  questions                  the survey itself, in the order it is answered
  gateway                    the secondary workflow: one coarse question, its
                             colour-coded answers, and the closing message each
                             answer lands on. Three options is the norm —
                             a good one (#47BA78), a neutral one (#FFBE4B) and
                             a bad one (#DC3232). Write a real closing message
                             for each, in the sender's voice.
  sms                        an SMS version of the invite. Leave enabled false
                             unless the description asks for text messages.

Question types: ${QUESTION_TYPES.join(', ')}.
  rating is 1-5 stars, slider is a 0-10 scale, open_ended is a text box.
  Set "options" for multiple_choice, dropdown, likert and ranking.
  Use null for options on rating, slider and open_ended.

Rules:
- Always return at least one question. Unless the description asks otherwise,
  open with an overall rating question.
- Write real copy, never placeholders. Keep every question short enough to read
  on a phone.
- Choose sensible defaults for anything the description leaves out: Manual
  source, 30 day expiry, 90 day cooldown, 2 reminders, any transaction type.
- Match the participant types to who the description is about. If it does not
  say, cover the ones that plausibly apply rather than guessing one.

Reply with the campaign object only.`

const looksLikeAKey = (v) => typeof v === 'string' && v.trim().length >= 20

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
  campaign: task('campaign_setup', CAMPAIGN_SYSTEM, CampaignDraft),
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
  ...(looksLikeAKey(process.env.ANTHROPIC_API_KEY)
    ? { claude: { label: 'Claude', group: 'Anthropic', envKey: 'ANTHROPIC_API_KEY', model: process.env.ANTHROPIC_MODEL || 'claude-opus-5', run: viaClaude } }
    : {}),
}

/**
 * Provider names with a usable key. A leftover placeholder from .env.example is
 * non-empty, so "is it set" is not the question — every real key from these
 * vendors is far longer than this, and offering a provider that cannot work is
 * worse than not offering it.
 */
export const availableProviders = () =>
  Object.keys(PROVIDERS).filter((name) => looksLikeAKey(process.env[PROVIDERS[name].envKey]))

export function resolveProvider(requested) {
  const want = requested || process.env.PARSER_PROVIDER
  if (want) {
    const p = PROVIDERS[want]
    if (!p) throw new Error(`Unknown provider "${want}". Use one of: ${Object.keys(PROVIDERS).join(', ')}`)
    if (!looksLikeAKey(process.env[p.envKey]))
      throw new Error(`${p.label} needs a real ${p.envKey} in your .env`)
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

/** A description of a campaign -> the setup form, filled in but not saved. */
export async function parseCampaign(text, requested) {
  const { provider, raw } = await run(text, TASKS.campaign, requested)
  return { provider, campaign: CampaignDraft.parse(raw) }
}
