# Nova Finance

A private, offline-first personal finance PWA that answers one question every day:

> **How much can I still spend today?** — ဒီနေ့ ဘယ်လောက်အထိ သုံးလို့ရသေးလဲ?

## Features
- Income & expenses in any currency, custom categories (icon, color, order, optional budget, "fixed cost" flag), recurring entries
- **Dynamic daily limit**: `(income − savings − emergency − protected − fixed reserve − spent before today) ÷ days left`. Spend less today and tomorrow's limit rises; spend more and it falls. An "even" mode is also available.
- Configurable budget period: monthly (any start day, e.g. pay day), custom dates, or every N days
- Category budgets with warnings (independent of the daily limit)
- Summaries for today / week / month / budget period / custom range
- Multi-currency (THB, MMK, USD, EUR, GBP, SGD, MYR, JPY, CNY + custom), exchange calculator
- Reference rates from open.er-api.com, clearly labelled **Live / Cached / Manual** with source and time
- Manual MMK rate (`1 THB = … MMK` or `1 USD = … MMK`), labelled "Manual / User-entered rate", preferred over provider rates
- JSON backup/restore (schema-validated, merge or replace, undo), CSV export
- Share today's summary via native share sheet, Telegram link or clipboard
- English & Myanmar, light & dark mode, installable, fully offline

## Privacy
All data is stored in the browser's IndexedDB on your device. No accounts, no analytics, no server.
The only network request fetches public reference exchange rates.

## Development
```bash
npm install
npm run dev        # local dev server
npm test           # unit tests (Vitest)
npm run e2e        # end-to-end tests (Playwright) against a production build
PROD_URL=https://<host>/<path>/ npm run e2e   # smoke-test a deployment
```

Architecture: `src/lib/` holds pure, tested logic (engine, dates, fx, backup, categories, share, db).
UI lives in `src/views` and `src/components` and never computes money itself.
