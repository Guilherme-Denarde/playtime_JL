# Playtime

Track kids' screen time with a daily allowance, reward tokens, penalties and blocks. It's built for use on a phone.

It is a static single-page app with no dependencies and no build step, deployed to GitHub Pages.

## Features

- One-tap start and stop per kid, with a live countdown, a 10-minute warning and "time's up"
- Sessions can be added or edited later, including old records with no end time
- Tokens can be saved or spent, and penalties remove tokens or minutes
- Blocks last for a number of hours or days, or until a set date
- History table, token and penalty log, totals per kid and device, weekly chart
- Read-only kid view, with admin actions behind a 4-digit PIN
- Works offline and installs to the home screen

## Choosing a database

You choose on first run, and can switch later in **Settings → Database**.

| | This device | Cloud (Supabase) |
|---|---|---|
| Setup | None | Free Supabase project, about 5 minutes |
| Login | Username and password, checked on the device | Email and password, checked by Supabase |
| Several phones | No | Yes, synced |
| If the phone is lost or wiped | Data is gone without a backup | Data is safe |

### Setting up Supabase

1. Create a project at [supabase.com](https://supabase.com).
2. In the SQL Editor, run [`supabase/schema.sql`](supabase/schema.sql).
3. In **Authentication → Sign In / Providers**, turn off "Confirm email" if you want to skip the confirmation email.
4. In Playtime, choose **Cloud database**, enter the project URL and publishable (anon) key, then tap **Create a new account**.
5. **Then turn off "Allow new users to sign up"** in the same Authentication settings, so nobody else can create an account in your project.

The publishable key is designed to be public. Row Level Security limits each account to its own row.

If two phones edit at once, changes are combined record by record, and the newest edit of each record wins.

## Security limits

- **Cloud mode** is real access control: Supabase enforces the login and row access on its server.
- **This-device mode** login and the PIN are door locks, not encryption. They stop casual use, but someone with the unlocked phone and browser developer tools could read or change the stored data.
- The PIN and password are stored as salted PBKDF2 hashes, and repeated wrong guesses trigger growing waits. A 4-digit PIN is meant to keep kids out of admin actions, not to stop a determined attacker.

## Good to know

- **iPhone:** use Share → Add to Home Screen. Safari can clear data from sites you haven't visited for 7 days, and installing the app avoids this. In this-device mode, also export backups regularly.
- **Alerts only work while the app is open.** The app can't send a warning when it's closed, and it doesn't turn devices off.
- **Time rules:** weeks start on Monday. Unused time doesn't carry over. Spent tokens and minute penalties only affect the day they're applied. A session with no end time isn't counted until you add one.
- **Token debt:** a token penalty can take the balance below zero.
- **Personal data:** GitHub Pages sites and public repos can be seen by anyone, so don't commit real names or records. Your data lives only in the database you choose. Setup links carry data after the `#`, which browsers don't send to servers, but treat any such link as private.

## Importing old records

Use **Settings → Backup → Import old written records**, one per line:

```
Ana 17/04 14:34–18:44 Tablet
Ana 06/05 17:04–(no end) Tablet
```

Dates are day/month. If no year is written, the most recent past date is used.

## Development

```sh
npm test    # logic tests, no install needed
npm start   # serves on http://localhost:8000
```

Pushing to `main` runs the tests and deploys to GitHub Pages using `.github/workflows/deploy.yml`.
