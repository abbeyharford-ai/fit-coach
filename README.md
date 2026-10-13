# Summer Coach

A personal trainer app that runs entirely on GitHub, for free (apart from Claude API usage).

- **Today**: coach check-in, water tracker, Garmin recovery (sleep, HRV, body battery, resting HR), weekly PRs, calorie and macro targets
- **Train**: workout logger with "repeat last session"; PRs are detected automatically
- **PRs**: estimated 1RM, heaviest sets and rep maxes per lift, with progress charts
- **Body**: upload an Evolt 360 scan (PDF or screenshots) and Claude extracts the numbers, compares them with past scans and gives you a trainer's read
- **Meals**: recomp targets from your Garmin burn and Evolt BMR, plus generated meal plans with a grocery list
- **Coach**: chat with a trainer who sees all your data. Tell it "did squats 3x5 at 135" and it logs the workout for you
- **Phone push** (via ntfy): a morning check-in, plus water reminders when you're behind, each with one-tap "Log 500 ml" buttons

## How it fits together

```
fit-coach  (PUBLIC repo → GitHub Pages)        fit-coach-data  (PRIVATE repo)
  the website: HTML/JS, no secrets      ◄────►   data/*.json      your workouts, scans, Garmin stats…
  talks to Claude with your API key     GitHub   .github/workflows/hourly.yml
  (stored in your browser only)          API       • Garmin sync every ~2.5 h
                                                   • morning check-in → ntfy → phone
                                                   • water nudges     → ntfy → phone
                                                 Secrets: GARMIN_TOKENS, NTFY_TOPIC, ANTHROPIC_API_KEY
```

Want to look around first? Open the site and click **Try with demo data**.

---

## Setup (about 20 minutes)

### 1. Create the two repos on GitHub

1. github.com → **New repository** → name it `fit-coach-data` → choose **Private** → Create.
2. github.com → **New repository** → name it `fit-coach` → choose **Public** (free Pages needs a public repo; this repo has no personal data in it) → Create.
3. Push the local folders (replace `abbeyharford-ai` with your GitHub username):

```bash
cd ~/fit-coach-data && git remote add origin https://github.com/abbeyharford-ai/fit-coach-data.git && git push -u origin main
```

```bash
cd ~/fit-coach && git remote add origin https://github.com/abbeyharford-ai/fit-coach.git && git push -u origin main
```

### 2. Turn on the website

In **fit-coach** → Settings → Pages → Source: *Deploy from a branch* → Branch `main` / `(root)` → Save.
A minute later your site is at `https://abbeyharford-ai.github.io/fit-coach/`.

### 3. Make a GitHub token for the website

github.com → your avatar → Settings → Developer settings → **Fine-grained tokens** → Generate new token:
- Repository access: **Only select repositories** → `fit-coach-data`
- Permissions → Repository → **Contents: Read and write**
- Expiration: up to 1 year (you'll paste a new one when it expires)

Open your site → ⚙︎ Settings → enter your username, `fit-coach-data` and the token, choose a passcode → **Save & connect**. Then fill in **Your profile**.

### 4. Add your Claude API key

Get a key from console.anthropic.com (Settings → API keys) and paste it in the site's Settings. It's stored encrypted in that browser only, so do this once per device.
Model: Sonnet 5.5 is the default. Opus 5.5 (deeper coaching, about 2x the cost) and Haiku 5.5 (cheapest) are in the dropdown.

### 5. Connect Garmin

On your PC, run this once. It asks for your Garmin login (and MFA code) and copies a token to your clipboard. Your password is never saved.

```bash
pip install garminconnect==0.3.16
```

```bash
python ~/fit-coach-data/scripts/garmin_login.py
```

In **fit-coach-data** → Settings → Secrets and variables → Actions → **New repository secret**: name `GARMIN_TOKENS`, paste the token.

### 6. Phone notifications (ntfy)

1. Install the **ntfy** app (iOS or Android).
2. Choose a long random topic name, like `fitcoach-k39xq2mzp7`. Anyone who knows the name can read your notifications, so make it unguessable.
3. In the app: **+** → subscribe to that topic.
4. In **fit-coach-data** → Settings → Secrets and variables → Actions:
   - Secret `NTFY_TOPIC` = your topic name
   - Secret `ANTHROPIC_API_KEY` = your Claude key (optional: without it, the morning check-in uses simple rules instead of Claude)
   - **Variables** tab → `SITE_URL` = `https://abbeyharford-ai.github.io/fit-coach` (makes the notification buttons open your site)

### 7. Start it

**fit-coach-data** → Actions → enable workflows if asked → **Trainer (hourly)** → **Run workflow**.
Check the log: you should see `Logged in. Syncing…`. Refresh your site and your Garmin data appears. After that it runs every hour by itself.

---

## Good to know

- **Water target** = 35 ml per kg of body weight, plus about 700 ml per hour of Garmin activity (or +500 ml on lifting days). Reminders only fire when you're 400+ ml behind pace, between your wake and bed hours.
- **Nutrition (recomp)**: maintenance comes from your 14-day Garmin average burn (or BMR × an activity factor at first); calories are set about 10% below it. Protein is 2 g/kg (based on lean mass when body fat is above 30%), fat 0.8 g/kg, and carbs fill the rest.
- **PRs**: estimated 1RM uses Epley (`weight × (1 + reps/30)`) on sets of 12 reps or fewer.
- **Schedule drift**: GitHub can run scheduled jobs late, so the check-in arrives within ~3 hours after your wake hour. The job checks its own state, so nothing gets missed or doubled.
- **Garmin library**: `garminconnect` is unofficial. If Garmin changes its login, the sync can break. Bump the version in `requirements.txt`, or rerun `garmin_login.py` and update the secret.
- **Costs**: GitHub is free (the hourly job uses about 800 of your 2,000 free Actions minutes per month). Claude usage is pay-as-you-go: a chat message or the daily check-in costs a cent or two, and a scan read or a week's meal plan costs well under a dollar on Sonnet 5.5.
- **Security**: your data lives only in your private repo; the public site holds no data or keys. On each device, your GitHub token and Claude key are encrypted with a passcode you choose (PBKDF2 + AES-256) and are only decrypted in the open tab. The app auto-locks after 30 minutes idle (or tap 🔒 Lock), and coach chats are wiped on lock. The page is only allowed to talk to GitHub and Claude. Forgot your passcode? Tap "Forgot passcode?" and paste a fresh token; your data isn't affected. For extra safety, turn on two-factor login for GitHub and the Anthropic console.
- **Not medical advice**: the coach will tell you to see a professional for pain, medical conditions or medications.

## Local development

```bash
python -m http.server 8765 --directory ~/fit-coach
```

Then open http://localhost:8765. There's no build step: plain ES modules, with Chart.js, marked, DOMPurify and the Anthropic SDK loaded from jsDelivr.
