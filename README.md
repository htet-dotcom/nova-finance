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
- **Wallet / accounts**: cash, bank, mobile money (KBZPay, Wave…) and credit cards, each in its own currency, with live balances, transfers between accounts (cross-currency with the actual received amount), archive, and **net worth** in the primary currency
- **Savings goals**: target amount and optional date, deposits/withdrawals with history, "save X per month" pace, on-track / behind status
- **Insights**: plain-language highlights (spending pace vs last month, category changes, most expensive weekday, savings rate, no-spend days), income vs expense trend for 6 months (with table view), category breakdown, weekday pattern. Chart colors are validated for color-blind readers in light and dark mode
- **App lock**: 4–8 digit PIN (PBKDF2-SHA-256, salted, never stored in plain text), optional fingerprint/face unlock via WebAuthn, auto-lock after time in the background, blur in the app switcher, escalating wait after 5 wrong attempts. The lock config is device-only and never part of backups
- English & Myanmar, light & dark mode, installable, fully offline

## Privacy
All data is stored in the browser's IndexedDB on your device. No accounts, no analytics, no server.
The only network request fetches public reference exchange rates.

The app lock keeps other people out of the app UI. It does not encrypt the IndexedDB data, so the device itself should also be locked.

## Development
```bash
npm install
npm run dev        # local dev server
npm test           # unit tests (Vitest)
npm run e2e        # end-to-end tests (Playwright) against a production build
PROD_URL=https://<host>/<path>/ npm run e2e   # smoke-test a deployment
```

### Android app (APK)
The same code is packaged as a native Android app with [Capacitor](https://capacitorjs.com/)
(`capacitor.config.ts`, package `com.lin.novafinance`). In the app, file export/sharing uses the
native share sheet and `Documents/NovaFinance`, biometric unlock uses the Android biometric prompt,
and the Android back button closes sheets / navigates back.

Requirements: JDK 21 and the Android SDK (`ANDROID_HOME`). Signing: create `android/keystore.properties`
(`storeFile`, `storePassword`, `keyAlias`, `keyPassword`), which is git-ignored. **Keep the keystore safe:
updates must be signed with the same key.**
```bash
npm run android:apk    # → android/app/build/outputs/apk/release/app-release.apk
npm run android:assets # regenerate icons & splash from the logo
```
Data in the Android app is separate from the browser PWA: move it with Settings → Export backup / Import backup.

Architecture: `src/lib/` holds pure, tested logic (engine, dates, fx, backup, categories, share, db,
accounts, goals, insights, lock). Data schema v2 (accounts, transfers, goals) migrates v1 databases and
v1 backup files automatically.
UI lives in `src/views` and `src/components` and never computes money itself.
