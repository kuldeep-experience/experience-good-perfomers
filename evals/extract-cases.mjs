/**
 * Ground truth for the extractor. Each case pairs text a user might paste with
 * the forms a careful person would fill in from it — including the fields that
 * must stay empty, because a confidently invented email address is the one
 * failure this tool must never have.
 */
const daysAgo = (n) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10)

const EMPTY = {
  recipient_first_name: null,
  recipient_last_name: null,
  email: null,
  contact_number: null,
  transaction_id: null,
  transaction_type: null,
  transaction_date: null,
  participant_type: null,
  city: null,
  state: null,
}
const draft = (over) => ({ ...EMPTY, ...over })

export const cases = [
  {
    name: 'one person, plain sentence',
    text: 'Send a survey to John Smith, john.smith@example.com, 555-0134. He closed a purchase on 2026-09-20, transaction TXN-77401, borrower, Austin TX.',
    expect: [
      draft({
        recipient_first_name: 'John',
        recipient_last_name: 'Smith',
        email: 'john.smith@example.com',
        contact_number: '555-0134',
        transaction_id: 'TXN-77401',
        transaction_type: 'Purchase',
        transaction_date: '2026-09-20',
        participant_type: 'BORROWER',
        city: 'Austin',
        state: 'TX',
      }),
    ],
  },
  {
    name: 'two participants share one loan',
    text: `Rosa Delgado (rosa.delgado@example.com) closed her refinance on 2026-09-15.
Loan number TXN-55120. Property is in Tampa, Florida.
Her co-borrower Luis Delgado should get one too — luis.delgado@example.com, same loan.`,
    expect: [
      draft({
        recipient_first_name: 'Rosa',
        recipient_last_name: 'Delgado',
        email: 'rosa.delgado@example.com',
        transaction_id: 'TXN-55120',
        transaction_type: 'Refinance',
        transaction_date: '2026-09-15',
        participant_type: 'BORROWER',
        city: 'Tampa',
        state: 'FL',
      }),
      draft({
        recipient_first_name: 'Luis',
        recipient_last_name: 'Delgado',
        email: 'luis.delgado@example.com',
        transaction_id: 'TXN-55120',
        transaction_type: 'Refinance',
        transaction_date: '2026-09-15',
        participant_type: 'COBORROWER',
        city: 'Tampa',
        state: 'FL',
      }),
    ],
  },
  {
    name: 'pasted spreadsheet, four rows',
    text: `name,email,loan,type,closed,role,city,state
Ana Reyes,ana.reyes@example.com,TXN-60011,Purchase,2026-09-18,borrower,Miami,FL
Marcus Chen,marcus.chen@example.com,TXN-60012,Refinance,2026-09-19,borrower,Tampa,FL
Grace Sato,grace.sato@example.com,TXN-60014,Listing,2026-09-21,seller,Austin,TX
Omar Qureshi,omar.qureshi@example.com,TXN-60015,Purchase,2026-09-22,buyer,Dallas,TX`,
    expect: [
      ['Ana', 'Reyes', 'ana.reyes@example.com', 'TXN-60011', 'Purchase', '2026-09-18', 'BORROWER', 'Miami', 'FL'],
      ['Marcus', 'Chen', 'marcus.chen@example.com', 'TXN-60012', 'Refinance', '2026-09-19', 'BORROWER', 'Tampa', 'FL'],
      ['Grace', 'Sato', 'grace.sato@example.com', 'TXN-60014', 'Listing', '2026-09-21', 'SELLER', 'Austin', 'TX'],
      ['Omar', 'Qureshi', 'omar.qureshi@example.com', 'TXN-60015', 'Purchase', '2026-09-22', 'BUYER', 'Dallas', 'TX'],
    ].map(([f, l, e, id, t, d, p, c, s]) =>
      draft({
        recipient_first_name: f,
        recipient_last_name: l,
        email: e,
        transaction_id: id,
        transaction_type: t,
        transaction_date: d,
        participant_type: p,
        city: c,
        state: s,
      }),
    ),
  },
  {
    // The case that matters most. Everything absent must come back null so the
    // validator can block it — a guessed email reaches a real person.
    name: 'details missing on purpose',
    text: 'Please survey the guest from room 402 who checked out last Friday. I think the booking was 4471.',
    // The text does give a checkout day, so a date is expected — but which
    // Friday "last Friday" means is genuinely ambiguous, so only its presence
    // is asserted. Everything else absent must come back null.
    expect: [
      draft({ transaction_id: '4471', participant_type: 'Customer1', transaction_date: 'any' }),
    ],
    loose: ['transaction_date'],
  },
  {
    name: 'relative date',
    text: 'Survey Dana Reyes at dana.reyes@example.com — she was the buyer, closed yesterday, deal DR-2210 in San Diego CA.',
    expect: [
      draft({
        recipient_first_name: 'Dana',
        recipient_last_name: 'Reyes',
        email: 'dana.reyes@example.com',
        transaction_id: 'DR-2210',
        transaction_date: daysAgo(1),
        participant_type: 'BUYER',
        city: 'San Diego',
        state: 'CA',
      }),
    ],
  },
  {
    name: 'two-word state name',
    text: 'Survey Farhan Qureshi, farhan.q@example.com, borrower on loan TXN-31002 closed 2026-09-10 in San Jose, California.',
    expect: [
      draft({
        recipient_first_name: 'Farhan',
        recipient_last_name: 'Qureshi',
        email: 'farhan.q@example.com',
        transaction_id: 'TXN-31002',
        transaction_date: '2026-09-10',
        participant_type: 'BORROWER',
        city: 'San Jose',
        state: 'CA',
      }),
    ],
  },
  {
    // Contact details listed apart from the names — the easy way to get this
    // wrong is to give both people the first email in the text.
    name: 'must not swap contact details',
    text: `Two sellers to survey from the Peachtree listing, both closed 2026-09-12, transaction PT-88 and PT-89 in Atlanta GA.
Yvonne Adeyemi and Samuel Brennan.
Emails: Samuel is samuel.brennan@example.com, Yvonne is yvonne.a@example.com.`,
    expect: [
      draft({
        recipient_first_name: 'Yvonne',
        recipient_last_name: 'Adeyemi',
        email: 'yvonne.a@example.com',
        transaction_id: 'PT-88',
        transaction_type: 'Listing',
        transaction_date: '2026-09-12',
        participant_type: 'SELLER',
        city: 'Atlanta',
        state: 'GA',
      }),
      draft({
        recipient_first_name: 'Samuel',
        recipient_last_name: 'Brennan',
        email: 'samuel.brennan@example.com',
        transaction_id: 'PT-89',
        transaction_type: 'Listing',
        transaction_date: '2026-09-12',
        participant_type: 'SELLER',
        city: 'Atlanta',
        state: 'GA',
      }),
    ],
  },
  {
    name: 'nobody to survey',
    text: 'Reminder: the quarterly campaign review is on Thursday. No action needed.',
    expect: [],
  },
]
