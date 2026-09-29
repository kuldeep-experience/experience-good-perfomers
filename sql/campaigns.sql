-- CAMPAIGN-OWNED. Everything this app writes lives here, never in the graph.
--
-- Campaigns, their "set conditions", and what has already been sent.
--
-- The Send Manual Survey drawer in XMP asks the user to check by hand that
-- "the source type in set conditions are updated correctly". These tables are
-- what makes that check something code can do instead.

create table if not exists campaigns (
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

create table if not exists survey_sends (
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
create table if not exists suppressions (
  email      text primary key,
  reason     text not null,                        -- unsubscribed | bounced
  created_at timestamptz not null default now()
);

-- A saved audience is a stored query, not a stored list of people: filter_json
-- is re-run on every read, so the audience means the same thing next week even
-- though it matches different people. row_count is only the number it matched
-- on the day it was saved, kept so drift is visible.
create table if not exists audiences (
  id          serial primary key,
  name        text not null,
  prompt_text text not null,
  filter_json jsonb not null,
  sql_text    text not null,
  row_count   int not null,
  created_at  timestamptz not null default now()
);

-- ponytail: seed data removed. Only dynamic data from the app is inserted.

-- The survey itself. XMP's editor lets a tier add any number of questions of
-- different types; one text column could not hold that.
alter table campaigns add column if not exists questions jsonb not null default '[]';

-- ---------------------------------------------------------------------------
-- The rest of the XMP setup wizard.

-- When the campaign was last touched. The campaigns screen sorts and reports
-- on it, so it has to be written on every save rather than guessed.
alter table campaigns add column if not exists updated_at timestamptz not null default now();

-- Secondary workflow: the gateway question, its colour-coded answers and the
-- message each answer ends on. All data, no branching code — which is why the
-- agent can write one and a person can read it back.
alter table campaigns add column if not exists gateway jsonb not null default
  '{"enabled": true,
    "question": "How would you rate your overall experience?",
    "options": [
      {"label": "Great",     "color": "#47BA78", "message": "Thank you for your great feedback! We appreciate your positive response."},
      {"label": "OK",        "color": "#FFBE4B", "message": "Thank you for your feedback. We will work to improve your experience."},
      {"label": "Unpleasant","color": "#DC3232", "message": "We are sorry to hear about your experience. We take your feedback seriously and will make improvements."}
    ]}'::jsonb;

alter table campaigns add column if not exists sms jsonb not null default
  '{"enabled": false, "text": "Hi {{first_name}}, how did we do? Tap to answer one question:"}'::jsonb;

-- What came back. Without it the completion rate and average score on the
-- campaigns screen would be decoration rather than a measurement.
alter table survey_sends add column if not exists rating int;
