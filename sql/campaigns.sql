-- CAMPAIGN-OWNED. Everything this app writes lives here, never in the graph.
--
-- Campaigns, their "set conditions", and what has already been sent.
--
-- The Send Manual Survey drawer in XMP asks the user to check by hand that
-- "the source type in set conditions are updated correctly". These tables are
-- what makes that check something code can do instead.

create table campaigns (
  id          serial primary key,
  name        text not null,
  status      text not null default 'Active',      -- Active | Paused
  -- Set conditions. A send that does not match these is accepted by the form
  -- and then quietly never reaches anyone.
  source_type text not null,                       -- Manual | Encompass | Salesforce | AMS360
  allowed_participant_types text[] not null,
  allowed_transaction_types text[] not null default '{}',  -- empty = any
  -- A survey older than this many days past the transaction is dead on arrival.
  expiry_days int not null default 30,
  -- Don't survey the same person twice inside this window.
  cooldown_days int not null default 90,
  reminders   int not null default 2,
  -- What the recipient actually sees. Templates are filled in by code, never
  -- by the model: {{first_name}} and {{transaction_id}} are the only slots.
  send_as     text not null default 'Experience.com <surveys@experience.com>',
  subject     text not null default 'How did we do, {{first_name}}?',
  intro       text not null default 'Thanks for working with us. One question, takes ten seconds.',
  question    text not null default 'How would you rate your experience?'
);

create table survey_sends (
  id               serial primary key,
  campaign_id      int not null references campaigns (id),
  transaction_id   text not null,
  email            text not null,
  participant_type text,
  transaction_date date not null,
  sent_at          timestamptz not null default now(),
  status           text not null default 'sent'    -- sent | completed | expired | bounced
);

-- Email-level suppression: unsubscribes and hard bounces. Checked on every
-- send, in code, the same way consent is checked on every audience query.
create table suppressions (
  email      text primary key,
  reason     text not null,                        -- unsubscribed | bounced
  created_at timestamptz not null default now()
);

-- A saved audience is a stored query, not a stored list of people: filter_json
-- is re-run on every read, so the audience means the same thing next week even
-- though it matches different people. row_count is only the number it matched
-- on the day it was saved, kept so drift is visible.
create table audiences (
  id          serial primary key,
  name        text not null,
  prompt_text text not null,
  filter_json jsonb not null,
  sql_text    text not null,
  row_count   int not null,
  created_at  timestamptz not null default now()
);

insert into campaigns
  (name, status, source_type, allowed_participant_types, allowed_transaction_types,
   expiry_days, cooldown_days, reminders, send_as, subject, intro, question)
values
  ('Survey Type Template',             'Active', 'Manual',
   array['BUYER','SELLER'],                 array[]::text[],            30, 90, 2,
   'DD Hotel <surveys@ddhotel.com>',
   'How did we do, {{first_name}}?',
   'Thanks for choosing us. One question, takes ten seconds.',
   'How would you rate your experience?'),
  ('Survey Type Template ( No reminder)', 'Active', 'Manual',
   array['BUYER','SELLER'],                 array[]::text[],            30, 90, 0,
   'DD Hotel <surveys@ddhotel.com>',
   'A quick word about your visit, {{first_name}}?',
   'No follow-ups, we promise — just this one.',
   'How would you rate your experience?'),
  ('Image question',                   'Active', 'Manual',
   array['Customer1','Customer2'],          array[]::text[],            45, 60, 2,
   'DD Hotel <surveys@ddhotel.com>',
   '{{first_name}}, tell us about your stay',
   'Your room, the service, the little things.',
   'How would you rate your stay with us?'),
  ('Public Reviews Campaign',          'Active', 'Encompass',
   array['BORROWER','COBORROWER'],          array['Purchase','Refinance'], 21, 180, 3,
   'DD Hotel Lending <reviews@ddhotel.com>',
   'How was your closing, {{first_name}}?',
   'You closed on {{transaction_id}}. Your answer may be published as a public review.',
   'How would you rate the service you received?'),
  ('Post-Close Loan Survey',           'Active', 'Encompass',
   array['BORROWER'],                       array['Purchase'],          14, 365, 2,
   'DD Hotel Lending <reviews@ddhotel.com>',
   'One question about loan {{transaction_id}}',
   'Now that everything has closed, we would like to know how it went.',
   'How would you rate your loan officer?'),
  ('Legacy Welcome Survey',            'Paused', 'Manual',
   array['Customer1'],                      array[]::text[],            30, 90, 1,
   'DD Hotel <surveys@ddhotel.com>',
   'Welcome, {{first_name}}',
   'A short welcome survey.',
   'How would you rate your first impression?');

-- Already-sent history, so duplicate and cooldown checks have something to hit.
insert into survey_sends (campaign_id, transaction_id, email, participant_type, transaction_date, sent_at)
values
  (4, 'TXN-88213', 'dana.reyes@example.com',  'BORROWER', current_date - 10, now() - interval '9 days'),
  (4, 'TXN-88300', 'omar.qureshi@example.com','BORROWER', current_date - 6,  now() - interval '5 days'),
  (1, 'TXN-11024', 'grace.sato@example.com',  'BUYER',    current_date - 20, now() - interval '19 days'),
  (5, 'TXN-90011', 'wei.chen@example.com',    'BORROWER', current_date - 3,  now() - interval '2 days');

insert into suppressions (email, reason) values
  ('nina.kowalski@example.com', 'unsubscribed'),
  ('peter.herrera@example.com', 'bounced');

-- The survey itself. XMP's editor lets a tier add any number of questions of
-- different types; one text column could not hold that. The seeded campaigns
-- get their single question lifted into the new shape rather than re-typed.
alter table campaigns add column questions jsonb not null default '[]';

update campaigns set questions = jsonb_build_array(
  jsonb_build_object('text', question, 'type', 'rating', 'options', null, 'required', true)
);

update campaigns set questions = questions || jsonb_build_array(
  jsonb_build_object('text', 'What stood out about your stay?', 'type', 'open_ended',
                     'options', null, 'required', false)
) where name = 'Image question';

-- ---------------------------------------------------------------------------
-- The rest of the XMP setup wizard.

-- When the campaign was last touched. The campaigns screen sorts and reports
-- on it, so it has to be written on every save rather than guessed.
alter table campaigns add column updated_at timestamptz not null default now();

-- Secondary workflow: the gateway question, its colour-coded answers and the
-- message each answer ends on. All data, no branching code — which is why the
-- agent can write one and a person can read it back.
alter table campaigns add column gateway jsonb not null default
  '{"enabled": true,
    "question": "How would you rate your overall experience?",
    "options": [
      {"label": "Great",     "color": "#47BA78", "message": "Thank you for your great feedback! We appreciate your positive response."},
      {"label": "OK",        "color": "#FFBE4B", "message": "Thank you for your feedback. We will work to improve your experience."},
      {"label": "Unpleasant","color": "#DC3232", "message": "We are sorry to hear about your experience. We take your feedback seriously and will make improvements."}
    ]}'::jsonb;

alter table campaigns add column sms jsonb not null default
  '{"enabled": false, "text": "Hi {{first_name}}, how did we do? Tap to answer one question:"}'::jsonb;

-- What came back. Without it the completion rate and average score on the
-- campaigns screen would be decoration rather than a measurement.
alter table survey_sends add column rating int;

update survey_sends set status = 'completed', rating = 5 where transaction_id = 'TXN-88213';
update survey_sends set status = 'completed', rating = 4 where transaction_id = 'TXN-11024';

-- Enough history that the numbers on the campaigns screen are computed.
insert into survey_sends
  (campaign_id, transaction_id, email, participant_type, transaction_date, sent_at, status, rating)
select
  c.id,
  'SEED-' || c.id || '-' || n,
  'person' || c.id || '-' || n || '@seed.example',
  c.allowed_participant_types[1],
  current_date - (n % 60),
  now() - ((n % 60) || ' days')::interval,
  case when (n * 7 + c.id) % 10 < 6 then 'completed' else 'sent' end,
  case when (n * 7 + c.id) % 10 < 6 then 3 + ((n + c.id) % 3) else null end
from campaigns c, generate_series(1, 140) n
where c.status = 'Active';
