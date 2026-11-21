# Coin Quest (working title)

A pixel-art budget and debt tracker. Your debts are monsters: payments are attacks, interest is regeneration.
It installs from the website ("Add to Home Screen") and works offline. All data stays on the device.

## Hosting (install on your phone)

Not switched on yet. `.github/workflows/coin-quest-pages.yml` publishes the app to GitHub Pages, but only when run by hand (Actions → Coin Quest site → Run workflow) while the app is still being built.
One-time setup: repository **Settings → Pages → Source: GitHub Actions**, then run the workflow.
The site address will be `https://<owner>.github.io/<repo>/`. Open it in Safari (iPhone) or Chrome (Android) and add it to the home screen.
GitHub Pages on a private repository needs a paid GitHub plan.

## Run it

- Locally: `python3 -m http.server` in this folder, then open http://localhost:8000
- Hosting: any static HTTPS host (e.g. GitHub Pages). HTTPS is required for offline mode and install.
- Tests: `npm test` (Node 20+, no dependencies)
- Icons: `npm run icons` regenerates `icons/` from the sprite data

## How it works

| Idea | Rule |
| --- | --- |
| Money | Stored as integer cents |
| Debt balance | Never stored. `startBalance + sum(ledger)`; payments are negative, interest/charges positive, Scout reports are corrections |
| Interest | Added automatically on each due date as `balance × APR ÷ 12`, catching up on months the app was closed |
| Monster type | Set by the debt's highest-ever balance: Slime < $500 ≤ Goblin < $2k ≤ Troll < $10k ≤ Young Dragon < $40k ≤ Elder Dragon (flying). Mortgages are a Castle. Paying it down never changes the type |
| Attacks | Share of the monster's full HP a payment takes off: Slash < 2% ≤ Cross Cut < 7% ≤ Heavy Blow < 20% ≤ Critical Strike < 45% ≤ Legendary Strike. Paying it off adds the Final Blow |
| Damage | Share of the peak paid off, in five stages: slashes, wounds, chunks knocked out, torn wings, duller colours, a hurt lean |
| Monster color | APR: calm < 5% ≤ angry < 15% ≤ furious |
| Regenerating | Minimum payment ≤ a month of interest. The debt never shrinks on minimums alone |
| Benched | Any debt (e.g. a mortgage) can be kept off the battlefield and out of the plan |
| Quest plan | Month-by-month simulation, avalanche or snowball, minimums roll over when a debt dies |
| Setup | Settings → Set up a new account: income sources, recurring bills, everyday spending, debts, goals, then a suggested split of what's left. Nothing is saved until Finish; the app starts empty |
| Budget | Monthly income (any pay frequency) − fixed bills − debt minimums = left over, which you assign to budget lines. Expenses are tracked against those lines each month |
| Budget link | The "Extra debt payments" line is the extra paid on top of minimums in the plan. Debt payments above the minimums count against it automatically |
| Current situation | Accounts (cash, savings, invested) with a starting balance; income, expenses, debt payments, paydays, bills and transfers move them, "Update balance" records a correction. Chart of each type over time |
| Money over time | Chart on the Budget tab: Checking, Savings or Income view; optional 12-month projection (dashed) that assumes the budget is followed, including planned one-off payments |
| Planned payments | One-off purchases (e.g. Black Friday) and debt payments (one time or every month) on the Spending tab or a debt's sheet. They count in projections (a debt payment only adds what's above its minimum) and become real when logged; monthly ones then roll to next month |
| Promo rates | A debt's rate applies until `promoEnds`, then `aprAfter` (interest, plan and projections all switch) |
| Credit card interest | Daily on each day's balance through the cycle; none for a cycle where the previous balance was paid in full |
| Loan pauses | Deferment/forbearance until `pauseUntil`: no payment due; interest accrues (or not) without compounding and is capitalized when the pause ends (optional) |
| Card purchases | An expense "paid with" a card adds a linked charge to that debt; paying the card off isn't counted as spending twice |
| Recurring posting | Income sources and bills with a next date and an account post automatically and roll forward |
| Budget options | One-month amounts, rollover of unspent money, savings deadlines (needed per month), irregular income averaged from recorded paydays |
| Editing | Every logged item can be edited; deletes and big changes can be undone for 7 seconds |
| Game | Achievements, weekly quests, boss (biggest debt) with HP-phase bonuses, missed-payment and overspending reactions, hero outfits and titles |
| Privacy lock | Passcode (salted SHA-256) and optional Face ID / fingerprint (WebAuthn). A privacy screen, not encryption |
| Transfer code | The whole save as gzip+base64 text to copy to another device |
| Save | One JSON document in IndexedDB. Backup = download that JSON; restore validates it first |

## Files

| File | Purpose |
| --- | --- |
| `js/money.js`, `js/dates.js` | Parsing/formatting cents and local dates |
| `js/debts.js` | Ledger balance, interest accrual, monster tiers |
| `js/planner.js` | Payoff simulation |
| `js/budget.js` | Monthly budget summary |
| `js/accounts.js` | Account balances, activity and history (current situation) |
| `js/projection.js` | Month-by-month actuals and projection for the chart |
| `js/recurring.js` | Paydays and bills posting on their dates |
| `js/game.js` | Achievements, quests, boss phases, skins |
| `js/lock.js` | Passcode hashing, WebAuthn, transfer codes |
| `js/chart.js` | SVG line chart with tap/hover tooltip |
| `js/player.js` | XP, levels, streaks |
| `js/state.js` | Save-file shape, validation, migrations |
| `js/storage.js` | IndexedDB, backup/restore |
| `js/sprites.js` | Hero sprite as a text grid + palettes |
| `js/models.js` | 3D-modelled monsters (signed-distance shapes, ray marched into dithered, outlined pixel art) and framed portraits |
| `js/battlefx.js` | Attack animations: five tiers by the share of full HP a payment takes off, plus a finishing blow; pixel effects on the battle stage, DOM moments as cues |
| `js/scenes.js` | First-person battle backdrops per monster type, sword and shield |
| `design/` | Battle screen design page (`node tools/build-design.mjs design/battle-design.template.html out.html`) |
| `js/ui.js`, `js/app.js` | Dialogs/forms, screens and actions |
| `sw.js`, `manifest.webmanifest` | Offline cache and install metadata (bump `VERSION` in `sw.js` when files change) |
