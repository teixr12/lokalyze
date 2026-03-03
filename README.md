# Lokalyze.site — Professional Batch HTML Translation & Localization

AI-powered tool to batch-translate HTML files into multiple languages while preserving code structure.

## Tech Stack

- **Frontend**: React 19 + TypeScript + Vite 6 + TailwindCSS v4
- **AI**: Google Gemini (`gemini-2.0-flash`)
- **Auth**: Firebase Auth (Google Sign-in)
- **Storage**: Supabase (cloud) + IndexedDB (local fallback)
- **Deployment**: Vercel

---

## Local Development Setup

### 1. Clone & Install
```bash
git clone <your-repo-url>
cd lokalyze.site-vf
npm install
```

### 2. Set Environment Variables

Copy `.env.example` to `.env` and fill in your values:

```bash
cp .env.example .env
```

| Variable | Required | Description |
|---|---|---|
| `VITE_FIREBASE_API_KEY` | ✅ | Firebase project API key |
| `VITE_FIREBASE_AUTH_DOMAIN` | ✅ | e.g. `your-app.firebaseapp.com` |
| `VITE_FIREBASE_PROJECT_ID` | ✅ | Firebase Project ID |
| `VITE_FIREBASE_STORAGE_BUCKET` | ✅ | Firebase storage bucket |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | ✅ | Firebase sender ID |
| `VITE_FIREBASE_APP_ID` | ✅ | Firebase app ID |
| `VITE_FIREBASE_MEASUREMENT_ID` | ⬜ | Optional: Firebase Analytics |
| `VITE_SUPABASE_URL` | ⬜ | Optional: required only for cloud sync |
| `VITE_SUPABASE_ANON_KEY` | ⬜ | Optional: required only for cloud sync |
| `VITE_GEMINI_API_KEY` | ⬜ | Optional default Gemini key (users can also enter their own in Settings) |

### 3. Supabase Setup

In your Supabase project's **SQL Editor**, run:

```sql
create table if not exists projects (
  id text primary key,
  user_id text not null,
  name text not null,
  created_at bigint not null,
  last_modified bigint not null,
  source_html text not null,
  global_css text not null,
  detected_images jsonb default '[]',
  detected_iframes jsonb default '[]',
  jobs jsonb default '{}',
  selected_langs jsonb default '[]'
);

-- Enable Row Level Security
alter table projects enable row level security;

-- Allow users to read/write only their own projects
create policy "Users manage own projects"
  on projects for all
  using (user_id = current_setting('app.current_user_id', true))
  with check (user_id = current_setting('app.current_user_id', true));
```

> **Important (Firebase Auth + Supabase Anon Key):** the policy above will block requests unless you inject `app.current_user_id` server-side.
> This app runs directly in the browser and does not inject that value today.
>
> For current app behavior (Firebase-only frontend), use:
>
> ```sql
> alter table projects disable row level security;
> ```
>
> If you need strict per-user security, add a trusted backend/Edge Function that validates Firebase ID tokens and proxies or signs Supabase requests.

### 4. Run Dev Server

```bash
npm run dev
# Open http://localhost:3000
```

---

## Deployment to Vercel

### Step 1: Push to GitHub

```bash
git add -A
git commit -m "feat: add Supabase, fix model names, add error boundary"
git push origin main
```

### Step 2: Import to Vercel

1. Go to [vercel.com](https://vercel.com) → **New Project** → Import your GitHub repo
2. Framework: **Vite** (auto-detected)
3. Add all environment variables from your `.env` in **Project Settings → Environment Variables**
4. Deploy!

The `vercel.json` SPA rewrite config is already included — no extra setup needed.

---

## Key Features

- 🌍 Batch translate HTML into 29 languages simultaneously
- ✨ AI-powered natural language adaptation (not just word-for-word)
- 🖼️ Image text translation via Gemini vision
- 🗂️ Project history with cloud sync (Supabase) or local storage (IndexedDB)
- 📦 Download translations as individual files or ZIP
- 🎨 Dark / Light mode
- 🔒 Google Sign-in via Firebase Auth

---

## License

© 2026 Lokalyze AI — DBE11 LTDA • CNPJ: 53.903.617/0001-83
