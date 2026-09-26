import { z } from 'zod'

/**
 * The campaign setup form, field for field — the thing a tier admin fills in by
 * hand in XMP before anyone can send anything.
 *
 * Same contract as the survey drafts: the model fills this in, code writes the
 * row, and a person presses Activate. Nothing here sends.
 */
export const QUESTION_TYPES = [
  'rating',
  'multiple_choice',
  'dropdown',
  'likert',
  'ranking',
  'slider',
  'open_ended',
]

export const Question = z.object({
  text: z.string(),
  type: z.enum(QUESTION_TYPES),
  // Only the list types use this. Nullable rather than optional: structured
  // outputs require every field to be present.
  options: z.array(z.string()).nullable(),
  required: z.boolean(),
})

export const GatewayOption = z.object({
  label: z.string(),
  color: z.string(),
  message: z.string(),
})

export const CampaignDraft = z.object({
  name: z.string(),
  source_type: z.string(),
  allowed_participant_types: z.array(z.string()),
  allowed_transaction_types: z.array(z.string()),
  expiry_days: z.number(),
  cooldown_days: z.number(),
  reminders: z.number(),
  send_as: z.string(),
  subject: z.string(),
  intro: z.string(),
  questions: z.array(Question),
  // Secondary workflow: one coarse question that decides which closing message
  // the recipient lands on.
  gateway: z.object({
    enabled: z.boolean(),
    question: z.string(),
    options: z.array(GatewayOption),
  }),
  sms: z.object({ enabled: z.boolean(), text: z.string() }),
})

const COLUMNS = [
  'name',
  'status',
  'source_type',
  'allowed_participant_types',
  'allowed_transaction_types',
  'expiry_days',
  'cooldown_days',
  'reminders',
  'send_as',
  'subject',
  'intro',
  'question',
  'questions',
  'gateway',
  'sms',
  'updated_at',
]

/** Insert a new campaign, or update the one the id names. Returns the row. */
export async function saveCampaign(db, c) {
  const values = COLUMNS.map((k) => {
    if (k === 'questions') return JSON.stringify(c.questions ?? [])
    if (k === 'gateway' || k === 'sms') return JSON.stringify(c[k] ?? {})
    // Written here rather than defaulted, so "last modified" means the last
    // time someone actually saved and not the day the row was created.
    if (k === 'updated_at') return new Date().toISOString()
    // The old single-question column still feeds the email preview, so keep it
    // pointed at whatever question the survey now opens with.
    if (k === 'question') return c.questions?.[0]?.text ?? 'How would you rate your experience?'
    if (k === 'status') return c.status ?? 'Draft'
    return c[k]
  })
  const params = values.map((_, i) => `$${i + 1}`)

  if (c.id) {
    const sets = COLUMNS.map((k, i) => `${k} = ${params[i]}`).join(', ')
    const { rows } = await db.query(
      `update campaigns set ${sets} where id = $${COLUMNS.length + 1} returning *`,
      [...values, c.id],
    )
    if (rows[0]) return rows[0]
  }
  const { rows } = await db.query(
    `insert into campaigns (${COLUMNS.join(', ')}) values (${params.join(', ')}) returning *`,
    values,
  )
  return rows[0]
}
