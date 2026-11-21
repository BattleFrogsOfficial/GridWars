# Coin Quest (working title)

A pixel-art budget and debt tracker. Your debts are monsters: payments are attacks, interest is regeneration.
It installs from the website ("Add to Home Screen") and works offline. All data stays on the device.

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
| Monster size | Balance: Slime < $500 ≤ Goblin < $2k ≤ Troll < $10k ≤ Young Dragon < $40k ≤ Elder Dragon. Mortgages are a Castle |
| Monster color | APR: calm < 5% ≤ angry < 15% ≤ furious |
| Regenerating | Minimum payment ≤ a month of interest. The debt never shrinks on minimums alone |
| Benched | Any debt (e.g. a mortgage) can be kept off the battlefield and out of the plan |
| Quest plan | Month-by-month simulation, avalanche or snowball, minimums roll over when a debt dies |
| Budget link | The budget's "Debt attack" limit minus minimums = extra per month in the plan. Debt payments count as Debt attack spending automatically |
| Save | One JSON document in IndexedDB. Backup = download that JSON; restore validates it first |

## Files

| File | Purpose |
| --- | --- |
| `js/money.js`, `js/dates.js` | Parsing/formatting cents and local dates |
| `js/debts.js` | Ledger balance, interest accrual, monster tiers |
| `js/planner.js` | Payoff simulation |
| `js/budget.js` | Monthly budget summary |
| `js/player.js` | XP, levels, streaks |
| `js/state.js` | Save-file shape, validation, migrations |
| `js/storage.js` | IndexedDB, backup/restore |
| `js/sprites.js` | Pixel sprites as text grids + palettes |
| `js/ui.js`, `js/app.js` | Dialogs/forms, screens and actions |
| `sw.js`, `manifest.webmanifest` | Offline cache and install metadata (bump `VERSION` in `sw.js` when files change) |
