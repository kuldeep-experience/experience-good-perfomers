import { z } from 'zod'

export const PARTICIPANT_TYPES = [
  'BORROWER',
  'COBORROWER',
  'BUYER',
  'SELLER',
  'Customer1',
  'Customer2',
]

/**
 * The Send Manual Survey drawer, as a schema. This is the only thing the model
 * is allowed to produce: it fills in the form, it does not send anything and it
 * cannot reach the database. Everything after this point is code.
 *
 * Nullable rather than optional — strict structured output wants every key
 * present, and `null` is how the model says "this wasn't in the text".
 */
export const SurveyDraft = z.object({
  recipient_first_name: z.string().nullable(),
  recipient_last_name: z.string().nullable(),
  email: z.string().nullable(),
  contact_number: z.string().nullable(),
  transaction_id: z.string().nullable(),
  transaction_type: z.string().nullable().describe('e.g. Purchase, Refinance, Listing'),
  transaction_date: z.string().nullable().describe('ISO date, YYYY-MM-DD'),
  participant_type: z.enum(PARTICIPANT_TYPES).nullable(),
  city: z.string().nullable().describe('City of the transaction'),
  state: z.string().nullable().describe('Two-letter state code of the transaction'),
})

export const DraftBatch = z.object({ drafts: z.array(SurveyDraft) })

/**
 * One transaction can legitimately carry several participants — a loan has a
 * BORROWER and a COBORROWER, a deal has a BUYER and a SELLER. So "already
 * surveyed" is per participant on a transaction, not per transaction.
 */
export const sendKey = (d) => `${d.transaction_id}|${d.participant_type ?? ''}`

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const DATE = /^\d{4}-\d{2}-\d{2}$/
const day = 86_400_000
// Whole elapsed days. Floor, not round: a transaction dated 21 days ago is 21
// days old at every hour of today, and rounding would age it a day early.
const daysBetween = (a, b) => Math.floor((a - b) / day)

/**
 * Everything validate() needs, fetched in one round trip so the check itself
 * stays a pure function — which is what makes it testable without a database.
 */
export async function loadContext(db, campaignId, drafts) {
  const emails = [...new Set(drafts.map((d) => d.email?.toLowerCase()).filter(Boolean))]
  const txnIds = [...new Set(drafts.map((d) => d.transaction_id).filter(Boolean))]

  const { rows: campaigns } = await db.query('select * from campaigns where id = $1', [campaignId])
  const { rows: suppressed } = emails.length
    ? await db.query('select email, reason from suppressions where email = any($1)', [emails])
    : { rows: [] }
  const { rows: sends } = await db.query(
    `select transaction_id, participant_type, email, sent_at from survey_sends
      where campaign_id = $1 and (transaction_id = any($2) or email = any($3))`,
    [campaignId, txnIds, emails],
  )

  return {
    campaign: campaigns[0] ?? null,
    suppressed: new Map(suppressed.map((r) => [r.email.toLowerCase(), r.reason])),
    sentKeys: new Set(sends.map(sendKey)),
    // Most recent send per email, for the cooldown check.
    lastSentTo: sends.reduce((m, r) => {
      const at = new Date(r.sent_at).getTime()
      const key = r.email.toLowerCase()
      if (!m.has(key) || m.get(key) < at) m.set(key, at)
      return m
    }, new Map()),
  }
}

/**
 * The part that is worth building even with the AI switched off.
 *
 * A survey can pass every field-level check in the UI and still never arrive,
 * because whether it arrives depends on the campaign's set conditions — which
 * live on a different screen. Today the drawer asks the user to go and verify
 * that by hand. This does it for them, before anything is sent.
 *
 * Blockers stop a send. Warnings are worth seeing but do not.
 */
export function validate(draft, ctx, now = Date.now()) {
  const d = SurveyDraft.parse(draft)
  const { campaign } = ctx
  const blockers = []
  const warnings = []
  const block = (field, message) => blockers.push({ field, message })
  const warn = (field, message) => warnings.push({ field, message })

  if (!campaign) {
    block('campaign', 'That campaign does not exist.')
    return { blockers, warnings }
  }
  if (campaign.status !== 'Active') {
    block('campaign', `"${campaign.name}" is ${campaign.status}. Nothing sends from it.`)
  }

  // --- required fields, same ones the drawer stars ---
  if (!d.recipient_first_name?.trim()) block('recipient_first_name', 'First name is required.')
  if (!d.email?.trim()) block('email', 'Email address is required.')
  else if (!EMAIL.test(d.email.trim())) block('email', `"${d.email}" is not a valid email address.`)
  if (!d.transaction_id?.trim()) block('transaction_id', 'Transaction Id is required.')
  if (!d.transaction_date) block('transaction_date', 'Transaction Date is required.')
  else if (!DATE.test(d.transaction_date))
    block('transaction_date', `"${d.transaction_date}" is not a date (expected YYYY-MM-DD).`)

  // --- set conditions: the check the UI asks a human to do ---
  const allowedP = campaign.allowed_participant_types ?? []
  if (!d.participant_type) {
    block('participant_type', `Participant Type is required. "${campaign.name}" accepts ${allowedP.join(' or ')}.`)
  } else if (allowedP.length && !allowedP.includes(d.participant_type)) {
    block(
      'participant_type',
      `"${campaign.name}" only surveys ${allowedP.join(' or ')} (source: ${campaign.source_type}). ` +
        `A ${d.participant_type} would be accepted by the form and never sent.`,
    )
  }

  const allowedT = campaign.allowed_transaction_types ?? []
  if (allowedT.length && d.transaction_type && !allowedT.includes(d.transaction_type)) {
    block(
      'transaction_type',
      `"${campaign.name}" set conditions allow ${allowedT.join(' or ')}, not "${d.transaction_type}".`,
    )
  } else if (allowedT.length && !d.transaction_type) {
    warn('transaction_type', `Not given. Set conditions expect ${allowedT.join(' or ')}.`)
  }

  // --- timing ---
  if (d.transaction_date && DATE.test(d.transaction_date)) {
    const age = daysBetween(now, Date.parse(`${d.transaction_date}T00:00:00Z`))
    if (age < 0) block('transaction_date', 'Transaction date is in the future.')
    else if (age > campaign.expiry_days) {
      block(
        'transaction_date',
        `${age} days old. "${campaign.name}" expires surveys after ${campaign.expiry_days} days, ` +
          'so this one would expire on arrival.',
      )
    } else if (age > campaign.expiry_days - 3) {
      warn('transaction_date', `${age} days old — expires in ${campaign.expiry_days - age} day(s).`)
    }
  }

  // --- who we must not email ---
  const email = d.email?.trim().toLowerCase()
  if (email) {
    const reason = ctx.suppressed.get(email)
    if (reason) block('email', `${d.email} has ${reason}. Not sending.`)

    const last = ctx.lastSentTo.get(email)
    if (last !== undefined) {
      const since = daysBetween(now, last)
      if (since < campaign.cooldown_days) {
        warn(
          'email',
          `Surveyed by this campaign ${since} day(s) ago. Cooldown is ${campaign.cooldown_days} days.`,
        )
      }
    }
  }
  if (d.transaction_id && d.participant_type && ctx.sentKeys.has(sendKey(d))) {
    block(
      'transaction_id',
      `The ${d.participant_type} on ${d.transaction_id} already has a survey from this campaign.`,
    )
  }

  // --- optional, but the data is worse without them ---
  if (!d.recipient_last_name?.trim()) warn('recipient_last_name', 'No last name.')
  if (!d.city?.trim() || !d.state?.trim()) warn('city', 'No city/state — location reporting will miss this one.')

  return { blockers, warnings }
}

/**
 * What the recipient will actually see, built from the campaign's template and
 * the draft. Substitution is a fixed whitelist filled in by code — the model
 * writes no part of the message, so a prompt cannot change what gets sent.
 */
export function renderSurvey(draft, campaign) {
  const slots = {
    first_name: draft.recipient_first_name?.trim() || 'there',
    last_name: draft.recipient_last_name?.trim() || '',
    transaction_id: draft.transaction_id ?? '',
    city: draft.city ?? '',
  }
  const fill = (t) => (t ?? '').replace(/\{\{(\w+)\}\}/g, (m, k) => (k in slots ? slots[k] : m))

  const expires =
    draft.transaction_date && DATE.test(draft.transaction_date)
      ? new Date(Date.parse(`${draft.transaction_date}T00:00:00Z`) + campaign.expiry_days * day)
          .toISOString()
          .slice(0, 10)
      : null

  return {
    from: campaign.send_as,
    to: draft.email,
    subject: fill(campaign.subject),
    intro: fill(campaign.intro),
    question: fill(campaign.question),
    campaign: campaign.name,
    expires,
    reminders: campaign.reminders,
  }
}
