-- GRAPH-OWNED (discipline 08). A stand-in for the entity graph.
--
-- In the real platform this discipline does not create these tables and cannot
-- alter them; it reads the view at the bottom of this file and nothing else.
-- They are defined here only so the prototype has something to read.
--
-- Campaign-owned tables — the ones this app actually writes — are in
-- sql/campaigns.sql. The split is the point.
--
-- Runs in PGlite (real Postgres), so this is the same SQL you'd run against
-- Supabase.

create table if not exists professionals (
  id                  serial primary key,
  name                text not null,
  email               text not null,
  title               text,
  company             text,
  city                text not null,
  state               text not null,
  industry            text not null,
  joined_at           timestamptz not null,
  srs_score           int,
  is_pro              boolean not null default false,
  subscription_status text not null default 'none',
  -- Consent columns. The compiler always filters on these; the model is never
  -- allowed to decide whether they apply.
  consent_status      text not null default 'granted',
  unsubscribed_at     timestamptz,
  last_login_at       timestamptz
);

create table if not exists reviews (
  id              serial primary key,
  professional_id int not null references professionals (id) on delete cascade,
  rating          int not null check (rating between 1 and 5),
  created_at      timestamptz not null,
  responded_at    timestamptz
);

-- ponytail: seed data removed. Only dynamic data from the app is inserted.

-- THE READ CONTRACT. The one graph object this discipline consumes.
--
-- One row per professional with the aggregates the filters need. Time-relative
-- questions ("reviewed in the last 90 days") become comparisons on these
-- columns, so no dynamic aggregate SQL is ever generated — and the base tables
-- can change shape underneath without a single filter changing.
--
-- ponytail: a plain view stands in for a versioned one. Real versioning means
-- campaign_professionals_v1 alongside v2 so consumers migrate on their own
-- schedule; add it when a second consumer exists.
create or replace view campaign_professionals as
select
  p.id, p.name, p.email, p.title, p.company, p.city, p.state, p.industry,
  p.joined_at, p.srs_score, p.is_pro, p.subscription_status,
  p.consent_status, p.unsubscribed_at, p.last_login_at,
  coalesce(count(r.id), 0)::int                                          as review_count,
  round(avg(r.rating)::numeric, 2)                                       as avg_rating,
  max(r.created_at)                                                      as last_review_at,
  max(r.created_at) filter (where r.responded_at is null)                as last_unreplied_review_at,
  count(r.id) filter (where r.responded_at is null)::int                 as unreplied_count
from professionals p
left join reviews r on r.professional_id = p.id
group by p.id;
