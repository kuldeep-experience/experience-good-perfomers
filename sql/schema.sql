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

create table professionals (
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

create table reviews (
  id              serial primary key,
  professional_id int not null references professionals (id) on delete cascade,
  rating          int not null check (rating between 1 and 5),
  created_at      timestamptz not null,
  responded_at    timestamptz
);

-- Deterministic seed, so eval expectations don't move between runs.
select setseed(0.42);

insert into professionals
  (name, email, title, company, city, state, industry, joined_at, srs_score,
   is_pro, subscription_status, consent_status, unsubscribed_at, last_login_at)
select
  fn || ' ' || ln,
  lower(fn) || '.' || lower(ln) || i || '@example.com',
  title, company,
  -- Two parallel arrays indexed by the same draw, so city and state agree.
  (array['Miami','Tampa','Orlando','Austin','Houston','Dallas','San Diego','San Jose','Atlanta','Seattle'])[loc],
  (array['FL','FL','FL','TX','TX','TX','CA','CA','GA','WA'])[loc],
  industry,
  now() - (r_join * 1400 || ' days')::interval,
  (40 + r_srs * 760)::int,
  is_pro,
  sub,
  case when r_consent < 0.08 then 'withheld' else 'granted' end,
  case when r_unsub < 0.06 then now() - (r_unsub * 300 || ' days')::interval end,
  case when r_login < 0.9 then now() - (r_login * 200 || ' days')::interval end
from (
  -- Every random() lives here, one draw per row. Computing them in a
  -- non-correlated subquery instead lets Postgres hoist it and hand every
  -- row the same value.
  select
    i,
    (array['Ana','Marcus','Priya','Tom','Lena','Derek','Hana','Curtis','Rosa','Farhan',
           'Grace','Samuel','Yvonne','Peter','Alicia','Nina','Omar','Wei','Sofia','Jamal'])
      [1 + floor(random() * 20)::int] as fn,
    (array['Reyes','Chen','Okafor','Vitkova','Nandan','Osei','Sato','Mbeki','Iglesias','Qureshi',
           'Brennan','Lindqvist','Adeyemi','Herrera','Kowalski','Delacroix','Castellanos','Nakamura'])
      [1 + floor(random() * 18)::int] as ln,
    (array['Real Estate Agent','Broker Associate','Mortgage Loan Officer','Buyer Agent',
           'Leasing Specialist','Branch Manager'])[1 + floor(random() * 6)::int] as title,
    (array['Brickell Key Realty','Wynwood Partners','Edgewater Home Co.','Sunset Harbour Group',
           'Lone Star Lending','Bay Area Realty Group','Peachtree Properties','Cascade Home Loans'])
      [1 + floor(random() * 8)::int] as company,
    (array['Real Estate','Mortgage','Insurance'])[1 + floor(random() * 3)::int] as industry,
    1 + floor(random() * 10)::int as loc,
    random() < 0.45 as is_pro,
    (array['active','active','active','trialing','past_due','canceled','none'])
      [1 + floor(random() * 7)::int] as sub,
    random() as r_join,
    random() as r_srs,
    random() as r_consent,
    random() as r_unsub,
    random() as r_login
  from generate_series(1, 420) i
) seeded;

-- Reviews. Roughly 60% of 24 slots fire per professional, and every ninth
-- profile is skipped entirely so "no reviews at all" has something to find.
insert into reviews (professional_id, rating, created_at, responded_at)
select
  professional_id,
  rating,
  created,
  case when replied then least(created + (reply_lag * 10 || ' days')::interval, now()) end
from (
  select
    p.id as professional_id,
    -- Skewed toward 5, so an "average of at least 4.5" filter has real
    -- winners and real losers rather than matching nobody.
    (array[3,4,4,5,5,5,5])[1 + floor(random() * 7)::int] as rating,
    now() - (random() * 500 || ' days')::interval as created,
    random() < 0.55 as replied,
    random() as reply_lag
  from professionals p
  cross join generate_series(1, 24) g
  -- Per-professional review volume, spread across 0-24.
  --
  -- This is arithmetic, not random(): a random() in the WHERE of this join is
  -- evaluated once per professional, so all 24 candidate rows share one draw
  -- and every profile ends up with either 0 or 24 reviews. Deriving the test
  -- from both p.id and g varies it per row -- and makes the seed reproducible,
  -- which the eval references depend on.
  where p.id % 9 <> 0
    and ((p.id * 31 + g * 17) % 97) < ((p.id * 7919) % 97)
) r;

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
create view campaign_professionals as
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
