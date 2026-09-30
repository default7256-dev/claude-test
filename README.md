# Excel Easy

A friendly helper that explains Microsoft Excel in plain English, built for complete beginners.
No install, no account, no build step: open `index.html` in any browser.

## What's inside

| Section | What it does |
| --- | --- |
| **Start here** | Type what you want in your own words ("add up a column", "make a chart") and get step-by-step instructions plus a ready-made formula. |
| **Lessons** | 11 short lessons (3–4 min each) from "meet the screen" to IF, charts and saving. Progress is remembered on your device. |
| **Formula builder** | Pick a task, fill in labelled boxes, get a formula with a plain-English explanation and a Copy button. |
| **Practice sheet** | A safe mini-spreadsheet with a real formula engine, undo, mini challenges, and friendly explanations of every cell and error. |
| **Fix a problem** | A formula checker (missing `=`, unbalanced brackets, semicolons, curly quotes, typos) and an error decoder (`#REF!`, `####`, …). |
| **Words & shortcuts** | Searchable glossary and the keyboard shortcuts that matter. |

Accessibility: keyboard friendly, screen-reader labels, adjustable text size (A+ / A−), light/dark mode, works on phones.

## Running it

```
npm install
export STRIPE_SECRET_KEY=sk_test_...      # a Stripe *test* key is fine to start
npm start                                  # http://localhost:3000
```

Test cards: `4242 4242 4242 4242`, any future date, any CVC. Sign-in links are printed to the server log until you set `RESEND_API_KEY`.

## How the subscription works

- **Free:** Start-here search, the first 3 lessons, error decoder, glossary and shortcuts (all in `public/`).
- **Premium (£5/month or £50/year, 7-day free trial):** formula builder, practice sheet, formula checker and lessons 4–11. The code and content for these live in `premium/`, which is **never served as static files**. `GET /api/premium.js` returns it only to a browser with a valid signed session cookie whose Stripe customer has an `active`/`trialing` subscription.
- **Plans:** prices are defined in code (`TRIAL_DAYS`, `MONTHLY_PRICE_PENCE`, `YEARLY_PRICE_PENCE`), so there's nothing to create in the Stripe dashboard. Trial subscribers count as Premium; Stripe charges the card automatically when the trial ends.
- **Buying:** "Start free trial" → choose monthly or yearly → Stripe Checkout (hosted by Stripe, so card details never touch this server) → back to `/api/checkout/complete`, which verifies the session with Stripe and signs the buyer in.
- **Returning:** "Sign in" → enter email → one-time link (15 min) is emailed if that email has an active subscription. The response is identical either way so emails can't be probed.
- **Cancelling / card updates / invoices:** "Manage subscription" opens the Stripe Customer Portal.
- **No database.** Stripe is the source of truth; subscription status is re-checked with Stripe at most every 5 minutes, so cancellations and failed payments take effect within about 5 minutes.

## Going live checklist

1. Create a Stripe account, finish business verification, then use your **live** secret key.
2. Nothing to set up in the Stripe dashboard: prices are created at checkout and the cancel/billing page (Customer Portal) is configured by the server on first use.
3. Host it anywhere that runs Node 20+ (Render, Railway, Fly.io, a VPS). Start command: `npm start`. Set the env vars from `.env.example`; `BASE_URL` must be your real `https://` address.
4. Email: create a [Resend](https://resend.com) account, verify your sending domain, set `RESEND_API_KEY` and `EMAIL_FROM`.
5. UK VAT: if you are (or must be) VAT-registered, set up Stripe Tax and `STRIPE_TAX=1`. Decide whether £5 is VAT-inclusive.
6. **Edit `public/terms.html` and `public/privacy.html`**: they are drafts with `[bracketed]` gaps and need a proper legal review (UK consumer law gives 14-day cancellation rights for online subscriptions).
7. Trial reminders: UK rules on subscription traps are tightening. Turn on Stripe's "trial ending" reminder emails (Settings → Billing → Subscriptions and emails), which is the one optional dashboard toggle, or add your own reminder email.
8. Test the whole loop in Stripe test mode first: start a trial on each plan, sign out, sign back in by email, cancel in the portal.

## Files

- `server.js` – web server, Stripe Checkout/portal, sign-in, Premium gating
- `public/` – the free site (`index.html`, `styles.css`, `app.js`, `data.js`, terms/privacy)
- `premium/` – Premium-only code and content (`engine.js` formula engine, `data.js`, `app.js`)
- `test/` – engine tests and server tests (fake Stripe)

## Run the tests

```
npm test
```

Excel is a trademark of Microsoft. This is an independent learning aid.
