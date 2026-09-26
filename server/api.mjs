import { getDb } from './db.mjs'
import { compile, toDisplaySQL } from './filter.mjs'
import { PROVIDERS, availableProviders, parseCampaign, parseDrafts, parsePrompt } from './parse.mjs'
import { saveCampaign } from './campaign.mjs'
import { loadContext, renderSurvey, sendKey, validate } from './draft.mjs'

const json = (res, status, body) => {
  res.statusCode = status
  res.setHeader('content-type', 'application/json')
  res.end(JSON.stringify(body))
}

const readBody = (req) => {
  // Serverless runtimes parse the JSON body for you and leave the stream
  // already consumed, so waiting on 'data' there hangs until the function
  // times out. Vite's middleware does not, hence both paths.
  if (req.body != null) {
    return Promise.resolve(typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body)
  }
  return new Promise((resolve, reject) => {
    let raw = ''
    req.on('data', (c) => (raw += c))
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {})
      } catch (e) {
        reject(e)
      }
    })
    req.on('error', reject)
  })
}

/** Runs a filter and returns the count plus a capped preview. */
export async function runFilter(filter) {
  const db = await getDb()
  const counted = compile(filter, { forCount: true })
  const listed = compile({ ...filter, limit: 10 })
  const [{ rows: countRows }, { rows }] = await Promise.all([
    db.query(counted.sql, counted.params),
    db.query(listed.sql, listed.params),
  ])
  return {
    count: countRows[0].n,
    rows,
    sql: toDisplaySQL(compile(filter)),
  }
}

/**
 * Check a batch of drafts against one campaign. Used by /api/draft to show the
 * user what is wrong, and again by /api/send — the client's copy of a verdict
 * is a display, never the thing that decides.
 */
async function checkAll(campaignId, drafts) {
  const db = await getDb()
  const ctx = await loadContext(db, campaignId, drafts)
  if (!ctx.campaign) throw new Error('That campaign does not exist.')
  // Two drafts in the same paste can collide with each other, not just with
  // history, so each accepted draft joins the set the next one is checked against.
  return {
    campaign: ctx.campaign,
    checked: drafts.map((draft) => {
      const result = validate(draft, ctx)
      if (!result.blockers.length && draft.transaction_id) ctx.sentKeys.add(sendKey(draft))
      return { draft, ...result, preview: renderSurvey(draft, ctx.campaign) }
    }),
  }
}

export async function handle(req, res) {
  const url = req.url.split('?')[0]
  try {
    if (req.method === 'POST' && url === '/api/build') {
      const { prompt, provider: requested } = await readBody(req)
      if (!prompt?.trim()) return json(res, 400, { error: 'Describe an audience first.' })
      const started = Date.now()
      const { provider, filter } = await parsePrompt(prompt, requested)
      const ms = Date.now() - started
      return json(res, 200, { provider, ms, filter, ...(await runFilter(filter)) })
    }

    if (req.method === 'POST' && url === '/api/save') {
      const { name, prompt, filter, sql, count } = await readBody(req)
      const db = await getDb()
      await db.query(
        `insert into audiences (name, prompt_text, filter_json, sql_text, row_count)
         values ($1, $2, $3, $4, $5)`,
        [name || prompt.slice(0, 60), prompt, JSON.stringify(filter), sql, count],
      )
      return json(res, 200, { ok: true })
    }

    if (req.method === 'GET' && url === '/api/campaigns') {
      const db = await getDb()
      // Recipients, responses, completion and score are counted here rather
      // than stored, so the campaigns screen can never show a stale number.
      const { rows } = await db.query(
        `select c.*,
                count(s.*)::int                                            as sent,
                count(*) filter (where s.status = 'completed')::int        as responses,
                round(avg(s.rating)::numeric, 2)::float                    as avg_score,
                max(s.sent_at)                                             as last_activity
           from campaigns c
           left join survey_sends s on s.campaign_id = c.id
          group by c.id
          order by c.id`,
      )
      return json(res, 200, { rows })
    }

    // Describe a campaign, get the setup form filled in. Saving is a second,
    // explicit call — the agent writes the draft, a person keeps or changes it.
    if (req.method === 'POST' && url === '/api/campaign') {
      const { text, campaign, provider: requested } = await readBody(req)
      const db = await getDb()
      if (campaign) return json(res, 200, { row: await saveCampaign(db, campaign) })
      if (!text?.trim()) return json(res, 400, { error: 'Describe the campaign first.' })
      const started = Date.now()
      const parsed = await parseCampaign(text, requested)
      return json(res, 200, { ...parsed, ms: Date.now() - started })
    }

    // Text in, checked drafts out. Nothing is sent and nothing is written.
    if (req.method === 'POST' && url === '/api/draft') {
      const { text, campaign_id, provider: requested, drafts: given } = await readBody(req)
      if (!campaign_id) return json(res, 400, { error: 'Pick a campaign first.' })

      // Editing a draft in the UI re-checks it without paying for the model again.
      if (given) return json(res, 200, { provider: null, ms: 0, ...(await checkAll(campaign_id, given)) })

      if (!text?.trim()) return json(res, 400, { error: 'Paste the recipient details first.' })
      const started = Date.now()
      const { provider, drafts } = await parseDrafts(text, requested)
      const ms = Date.now() - started
      if (!drafts.length) return json(res, 200, { provider, ms, checked: [], campaign: null })
      return json(res, 200, { provider, ms, ...(await checkAll(campaign_id, drafts)) })
    }

    // The only endpoint that writes a send. It re-validates from scratch, so a
    // draft that was edited after it was checked cannot slip through.
    if (req.method === 'POST' && url === '/api/send') {
      const { campaign_id, drafts } = await readBody(req)
      if (!campaign_id || !drafts?.length) return json(res, 400, { error: 'Nothing to send.' })
      const { checked } = await checkAll(campaign_id, drafts)
      const clean = checked.filter((c) => !c.blockers.length)
      const db = await getDb()
      for (const { draft } of clean) {
        await db.query(
          `insert into survey_sends (campaign_id, transaction_id, email, participant_type, transaction_date)
           values ($1, $2, $3, $4, $5)`,
          [campaign_id, draft.transaction_id, draft.email, draft.participant_type, draft.transaction_date],
        )
      }
      return json(res, 200, {
        sent: clean.length,
        blocked: checked.length - clean.length,
        checked,
      })
    }

    if (req.method === 'GET' && url === '/api/providers') {
      const available = availableProviders()
      return json(res, 200, {
        available,
        all: Object.entries(PROVIDERS).map(([name, p]) => ({
          name,
          label: p.label,
          group: p.group,
          model: p.model,
          ready: available.includes(name),
          envKey: p.envKey,
        })),
      })
    }

    // A saved audience is a stored *query*, not a stored list of people. Every
    // read re-runs it, so the count is what the audience means today rather
    // than what it happened to match on the day it was saved.
    if (req.method === 'GET' && url === '/api/audiences') {
      const db = await getDb()
      const { rows } = await db.query(
        'select id, name, filter_json, row_count, created_at from audiences order by id desc limit 20',
      )
      const live = await Promise.all(
        rows.map(async (r) => {
          try {
            const { sql, params } = compile(r.filter_json, { forCount: true })
            const { rows: n } = await db.query(sql, params)
            return n[0].n
          } catch {
            // A stored filter that no longer compiles is itself worth showing.
            return null
          }
        }),
      )
      return json(res, 200, {
        rows: rows.map((r, i) => ({
          id: r.id,
          name: r.name,
          saved_count: r.row_count,
          live_count: live[i],
          created_at: r.created_at,
        })),
      })
    }

    return json(res, 404, { error: 'Not found' })
  } catch (err) {
    // Provider/credential problems are the user's to fix, so say so plainly
    // rather than burying them in a 500.
    const isConfig = /API_KEY|provider/i.test(err?.message ?? '')
    return json(res, isConfig ? 401 : 500, { error: err?.message || 'Something went wrong.' })
  }
}
