// Types and field metadata used by both the chat flow and the bulk paste view.
export type Draft = Record<string, string | null>
export type Note = { field: string; message: string }

export type Preview = {
  from: string
  to: string | null
  subject: string
  intro: string
  question: string
  campaign: string
  expires: string | null
  reminders: number
}

export type Checked = {
  draft: Draft
  blockers: Note[]
  warnings: Note[]
  preview: Preview
}

export const PARTICIPANT_TYPES = [
  'BORROWER',
  'COBORROWER',
  'BUYER',
  'SELLER',
  'Customer1',
  'Customer2',
]

export const SOURCE_TYPES = ['Manual', 'Encompass', 'Salesforce', 'AMS360']

export const QUESTION_TYPES = [
  'rating',
  'multiple_choice',
  'dropdown',
  'likert',
  'ranking',
  'slider',
  'open_ended',
] as const

export type QuestionType = (typeof QUESTION_TYPES)[number]

export type Question = {
  text: string
  type: QuestionType
  options: string[] | null
  required: boolean
}

export const QUESTION_LABELS: Record<QuestionType, string> = {
  rating: 'Rating Scale',
  multiple_choice: 'Multiple Choice',
  dropdown: 'Dropdown',
  likert: 'Likert Scale',
  ranking: 'Ranking Question',
  slider: 'Slider Question',
  open_ended: 'Open Ended',
}

// A new question of each type, so "Add New Question" has something to add.
export const BLANK_QUESTION = (type: QuestionType): Question => ({
  text: '',
  type,
  options: ['multiple_choice', 'dropdown', 'ranking'].includes(type)
    ? ['Option 1', 'Option 2']
    : type === 'likert'
      ? ['Strongly disagree', 'Disagree', 'Neutral', 'Agree', 'Strongly agree']
      : null,
  required: true,
})

export type GatewayOption = { label: string; color: string; message: string }
export type Gateway = { enabled: boolean; question: string; options: GatewayOption[] }

export type Campaign = {
  id: number
  name: string
  status: string
  source_type: string
  questions: Question[]
  send_as: string
  subject: string
  intro: string
  allowed_participant_types: string[]
  allowed_transaction_types: string[]
  expiry_days: number
  cooldown_days: number
  reminders: number
  gateway: Gateway
  sms: { enabled: boolean; text: string }
  updated_at: string
  sent: number
  responses: number
  avg_score: number | null
  last_activity: string | null
}

export type Provider = {
  name: string
  label: string
  group: string
  model?: string
  ready: boolean
  envKey: string
}

// The Send Manual Survey drawer, field for field.
export const FIELDS: [key: string, label: string, required?: boolean][] = [
  ['recipient_first_name', 'First Name', true],
  ['recipient_last_name', 'Last Name'],
  ['email', 'Email Address', true],
  ['contact_number', 'Contact Number'],
  ['transaction_id', 'Transaction Id', true],
  ['transaction_type', 'Transaction type'],
  ['transaction_date', 'Transaction Date', true],
  ['participant_type', 'Participant Type'],
  ['city', 'City of transactions'],
  ['state', 'State of transaction'],
]

export const EMPTY_DRAFT: Draft = Object.fromEntries(FIELDS.map(([k]) => [k, null]))

export const iso = (daysAgo: number) =>
  new Date(Date.now() - daysAgo * 86_400_000).toISOString().slice(0, 10)

/**
 * Click-to-fill options, taken from the campaign's own set conditions rather
 * than a hardcoded list — so the suggestions can never offer a value the
 * campaign would reject.
 */
export function suggestionsFor(key: string, campaign?: Campaign): [label: string, value: string][] {
  if (key === 'participant_type')
    return (campaign?.allowed_participant_types ?? []).map((t) => [t, t])
  // Campaign-only. A suggestion the campaign does not allow is a trap: the
  // form takes it and the send is then dropped by the set conditions.
  if (key === 'transaction_type')
    return (campaign?.allowed_transaction_types ?? []).map((t) => [t, t])
  if (key === 'transaction_date')
    return [
      ['Today', iso(0)],
      ['Yesterday', iso(1)],
      ['3 days ago', iso(3)],
      ['A week ago', iso(7)],
    ]
  return []
}
