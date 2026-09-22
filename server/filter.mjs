import { z } from 'zod'

/**
 * The only graph-owned object this discipline touches, and it touches it
 * read-only. Discipline 08 owns the graph: twelve disciplines read from it and
 * any one of them writing to it breaks the other eleven, so schema changes
 * originate there and nowhere else. Campaigns consumes a view, never the base
 * tables, so 08 can reshape what is underneath without breaking this.
 *
 * Everything this app writes — audiences, survey_sends, suppressions — lives in
 * campaign-owned tables. Nothing here ever writes to the graph.
 */
export const GRAPH_VIEW = 'campaign_professionals'

export const SUBSCRIPTION_STATES = ['active', 'trialing', 'past_due', 'canceled', 'none']
export const ORDER_FIELDS = ['srs_score', 'review_count', 'avg_rating', 'joined_at']

/**
 * The only thing the model is allowed to produce. It never writes SQL — it
 * fills in this form, and compile() below turns the form into a query.
 *
 * Every field is nullable rather than optional: strict structured output
 * requires all keys present, and `null` is how the model says "not asked for".
 */
export const AudienceFilter = z.object({
  states: z.array(z.string()).nullable().describe('Two-letter state codes, e.g. ["FL","TX"]'),
  cities: z.array(z.string()).nullable(),
  industries: z.array(z.string()).nullable().describe('One of: Real Estate, Mortgage, Insurance'),
  subscription_status: z.array(z.enum(SUBSCRIPTION_STATES)).nullable(),
  is_pro: z.boolean().nullable(),
  joined_after: z.string().nullable().describe('ISO date, inclusive. Joined on or after this date'),
  joined_before: z.string().nullable().describe('ISO date, exclusive. Joined before this date'),
  min_avg_rating: z.number().nullable(),
  max_avg_rating: z.number().nullable(),
  min_reviews: z.number().int().nullable(),
  max_reviews: z.number().int().nullable(),
  has_reviews: z.boolean().nullable().describe('false = has no reviews at all'),
  reviewed_within_days: z.number().int().nullable().describe('Received any review in the last N days'),
  unreplied_review_within_days: z
    .number()
    .int()
    .nullable()
    .describe('Has a review from the last N days that was never replied to'),
  has_unreplied_reviews: z.boolean().nullable(),
  inactive_days: z.number().int().nullable().describe('Has not logged in for at least N days'),
  min_srs: z.number().int().nullable(),
  max_srs: z.number().int().nullable(),
  order_by: z.enum(ORDER_FIELDS).nullable(),
  limit: z.number().int().nullable(),
})

const daysAgo = (n) => new Date(Date.now() - n * 86_400_000).toISOString()

/**
 * Filter -> SQL. This is the guardrail: consent and unsubscribe are appended
 * here, in code, on every single query. The model has no field that can switch
 * them off, so there is no prompt that makes the tool email someone who opted
 * out. Values are bound as parameters, never interpolated.
 */
export function compile(filter, { forCount = false } = {}) {
  const f = AudienceFilter.parse(filter)
  const params = []
  const bind = (v) => `$${params.push(v)}`
  const inList = (col, vals) => `${col} in (${vals.map(bind).join(', ')})`

  // Always applied. Not model-controlled.
  const where = ['consent_status = \'granted\'', 'unsubscribed_at is null']

  if (f.states?.length) where.push(inList('state', f.states.map((s) => s.toUpperCase())))
  if (f.cities?.length) where.push(inList('city', f.cities))
  if (f.industries?.length) where.push(inList('industry', f.industries))
  if (f.subscription_status?.length) where.push(inList('subscription_status', f.subscription_status))
  if (f.is_pro !== null) where.push(`is_pro = ${bind(f.is_pro)}`)
  if (f.joined_after) where.push(`joined_at >= ${bind(f.joined_after)}`)
  if (f.joined_before) where.push(`joined_at < ${bind(f.joined_before)}`)
  if (f.min_avg_rating !== null) where.push(`avg_rating >= ${bind(f.min_avg_rating)}`)
  if (f.max_avg_rating !== null) where.push(`avg_rating <= ${bind(f.max_avg_rating)}`)
  if (f.min_reviews !== null) where.push(`review_count >= ${bind(f.min_reviews)}`)
  if (f.max_reviews !== null) where.push(`review_count <= ${bind(f.max_reviews)}`)
  if (f.has_reviews !== null) where.push(f.has_reviews ? 'review_count > 0' : 'review_count = 0')
  if (f.reviewed_within_days !== null)
    where.push(`last_review_at >= ${bind(daysAgo(f.reviewed_within_days))}`)
  if (f.unreplied_review_within_days !== null)
    where.push(`last_unreplied_review_at >= ${bind(daysAgo(f.unreplied_review_within_days))}`)
  if (f.has_unreplied_reviews !== null)
    where.push(f.has_unreplied_reviews ? 'unreplied_count > 0' : 'unreplied_count = 0')
  if (f.inactive_days !== null)
    where.push(`(last_login_at is null or last_login_at < ${bind(daysAgo(f.inactive_days))})`)
  if (f.min_srs !== null) where.push(`srs_score >= ${bind(f.min_srs)}`)
  if (f.max_srs !== null) where.push(`srs_score <= ${bind(f.max_srs)}`)

  const select = forCount
    ? 'count(*)::int as n'
    : 'id, name, email, city, state, industry, subscription_status, is_pro, srs_score, review_count, avg_rating'

  let sql = `select ${select}\nfrom ${GRAPH_VIEW}\nwhere ${where.join('\n  and ')}`

  if (!forCount) {
    if (f.order_by) sql += `\norder by ${f.order_by} desc nulls last`
    sql += `\nlimit ${Math.min(f.limit ?? 10_000, 10_000)}`
  }

  return { sql, params }
}

/** Display only — inlines bound values so the query is readable on screen. */
export function toDisplaySQL({ sql, params }) {
  return sql.replace(/\$(\d+)/g, (_, i) => {
    const v = params[Number(i) - 1]
    return typeof v === 'string' ? `'${v}'` : String(v)
  })
}
