# Supabase Setup Guide

## What Changed
✓ Removed PGlite (in-memory database)
✓ Now using Supabase PostgreSQL (cloud database)
✓ ALL data persists in Supabase (campaigns & surveys)
✓ Data survives server restart

## Setup Steps

### 1. Get Supabase Connection String

1. Open Supabase Dashboard: https://app.supabase.com
2. Select your project
3. Go to **Settings** → **Database**
4. Copy the **Connection String** (URI format)
5. It looks like:
   ```
   postgresql://postgres:[PASSWORD]@[HOST]:[PORT]/postgres
   ```

### 2. Add to `.env`

Open `.env` file and replace the placeholder:

```bash
# Before:
DATABASE_URL=postgresql://postgres:[YOUR_PASSWORD]@[YOUR_HOST]:[PORT]/postgres

# After (with actual values):
DATABASE_URL=postgresql://postgres:AbCd1234xyz@hznwhubndllmttxisngb.supabase.co:5432/postgres
```

### 3. Test Connection

```bash
node check-connection.mjs
```

Expected output:
```
✓ Connected to Supabase
✓ Tables created: campaigns, survey_sends
✓ Ready to use
```

### 4. Start Server

```bash
npm run dev
```

The app will:
1. Connect to Supabase
2. Create tables (if not exist)
3. Load seed data (campaigns.sql)
4. Ready for campaigns & surveys

---

## What's Stored in Supabase

### `campaigns` table
- Campaign name, status, rules
- Questions, gateway, SMS
- Source type, conditions
- Updated timestamp

### `survey_sends` table
- Campaign ID, recipient data
- Transaction ID, type, date
- Sent timestamp, completion status
- Rating (1-5)

---

## Verify Data Persists

### After creating a campaign:
```bash
node check-data.mjs
```
Shows all campaigns & surveys

### After restarting server:
```bash
npm run dev
# (stop with Ctrl+C)
npm run dev  # restart
```
Campaigns & surveys still there ✓

---

## Important

- **Do NOT commit `.env`** — contains credentials
- Supabase free tier allows 500MB storage
- All data is now persistent 🎉

---

## Troubleshooting

### "Connection refused"
- Check DATABASE_URL format
- Verify Supabase project is active

### "Cannot find table campaigns"
- Server will create tables automatically on first run
- Check server logs for SQL errors

### "Password authentication failed"
- Verify password in DATABASE_URL is correct
- Check for special characters (URL-encode if needed)

