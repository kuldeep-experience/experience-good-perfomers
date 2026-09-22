// The API as a Vercel serverless function.
//
// In development the same handler runs inside Vite's dev-server middleware
// (see vite.config.ts). That middleware does not exist in a production build —
// `vite build` emits static files only — so without this file every /api/*
// request 404s once deployed.
//
// ponytail: each function instance seeds its own in-process PGlite database
// (~1.8s cold start), so sends do not persist and two instances do not see the
// same data. Fine for a demo; point server/db.mjs at a hosted Postgres the
// moment anything needs to survive a request.
import { handle } from '../server/api.mjs'

export default function (req, res) {
  // vercel.json rewrites /api/campaigns -> /api/index?path=campaigns, so put
  // the original path back before the handler routes on it.
  const path = new URL(req.url, 'http://x').searchParams.get('path')
  if (path) req.url = `/api/${path}`
  return handle(req, res)
}
