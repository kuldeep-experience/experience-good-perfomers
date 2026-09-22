/**
 * Ground truth. Each case pairs a plain-English request with the query a
 * person who knows the schema would write by hand. The runner compares the
 * ids the model's filter produces against the ids the reference produces,
 * so "did it work" is a number, not an opinion.
 *
 * Every reference carries the same consent guard the compiler injects, so a
 * mismatch is always about understanding and never about the guardrail.
 */
const GUARD = `consent_status = 'granted' and unsubscribed_at is null`
const ref = (clause) => `select id from campaign_professionals where ${GUARD} and ${clause}`

export const cases = [
  {
    name: 'state + unreplied within window',
    prompt: 'everyone in Florida who got a review in the last 90 days but never replied to it',
    reference: ref(`state = 'FL' and last_unreplied_review_at >= now() - interval '90 days'`),
  },
  {
    name: 'pro + state + rating floor',
    prompt: 'PRO subscribers in Texas with an average rating of at least 4.5',
    reference: ref(
      `is_pro and state = 'TX' and subscription_status in ('active','trialing') and avg_rating >= 4.5`,
    ),
  },
  {
    name: 'absence — no reviews at all',
    prompt: 'professionals with no reviews at all',
    reference: ref(`review_count = 0`),
  },
  {
    name: 'industry + state + calendar year',
    prompt: 'mortgage professionals in Florida who joined this year',
    reference: ref(`industry = 'Mortgage' and state = 'FL' and joined_at >= date_trunc('year', now())`),
  },
  {
    name: 'lapsed subscriptions',
    prompt: 'customers whose subscription was cancelled or is past due',
    reference: ref(`subscription_status in ('canceled','past_due')`),
  },
  {
    name: 'inactivity, including never-logged-in',
    prompt: "anyone who hasn't logged in for 60 days",
    reference: ref(`(last_login_at is null or last_login_at < now() - interval '60 days')`),
  },
  {
    name: 'ranking + limit',
    prompt: 'top 100 by search rank score in California',
    reference: `select id from campaign_professionals where ${GUARD} and state = 'CA'
                order by srs_score desc nulls last limit 100`,
  },
  {
    name: 'multi-city + industry',
    prompt: 'insurance professionals in Miami or Tampa',
    reference: ref(`industry = 'Insurance' and city in ('Miami','Tampa')`),
  },
  {
    name: 'subscribers with a review-count ceiling',
    prompt: 'subscribers with fewer than 5 reviews',
    reference: ref(`subscription_status in ('active','trialing') and review_count < 5`),
  },
  {
    name: 'unreplied, no time window',
    prompt: 'professionals who have at least one review they never replied to',
    reference: ref(`unreplied_count > 0`),
  },
  {
    name: 'multi-state',
    prompt: 'everyone in Georgia or Washington',
    reference: ref(`state in ('GA','WA')`),
  },
  {
    name: 'combined — state, pro, volume, recency',
    prompt:
      'PRO professionals in Florida with more than 10 reviews who got a review in the last 30 days',
    reference: ref(
      `is_pro and state = 'FL' and review_count > 10 and last_review_at >= now() - interval '30 days'`,
    ),
  },
]
