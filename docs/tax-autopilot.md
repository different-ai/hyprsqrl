# Tax Autopilot

> Zero-click quarterly-tax withholding & vaulting for US/EU freelancers.

## How it works

1. **Document ingestion**  
   • Emails & uploaded PDFs are parsed by the LLM chain (`processDocumentFromEmailText`) into a deterministic XML schema.  
   • `invoice-extractor` calls `ingestInvoice`, which stores the XML + AI metadata and records an immutable `income` event in `ledger_events`.

2. **Rule engine**  
   • `tax-rule-engine.ts` listens to ledger event bus.  
   • For every `income` event it withholds the correct percentage (US 25 %, DE/NL 30 %) and writes a matching `tax_hold` event.

3. **Liability tracking**  
   • `liability-calculator.ts` computes totals (held – released) on-demand via `trpc.tax.getLiability`.

4. **User interface**  
   • `TaxVaultBalanceTile` shows current vault balance vs liability.  
   • If under-funded, `TaxApprovalCard` appears allowing the user to approve a Safe transaction that sweeps missing USDC to their tax vault.

5. **Vault transfer & yield**  
   • `vault-transfer.ts` builds the Safe ERC-20 transfer.  
   • Optional: `morpho-vault.ts` deposits idle USDC into the Morpho ERC-4626 vault for yield.

## Database additions

| Table | Column | Purpose |
|-------|--------|---------|
| `ledger_events` | _new_ | Append-only financial event stream (income, tax_hold, tax_release, etc.) |
| `user_profiles` | `country_code` | 2-letter residence code used by rule engine |

## Environment variables

```
NEXT_PUBLIC_BASE_RPC_URL   # Base RPC URL
APRIVATE_KEY_OWNER1        # Owner key for Safe transactions
```

## Dogfooding

Run the seed script:
```bash
cd packages/web
pnpm ts-node scripts/dogfood/create-test-data.ts
```
This creates:
* Test user with US residence
* Example `income` + `tax_hold` events

Start dev server and login with the test account to see the tile/card on `/dashboard`.

## Open tasks

- Integrate PDF upload route with `ingestInvoice` (same as email).  
- After sweep confirmation, automatically call `depositToMorphoVault`.  
- Provide UI to change `countryCode`.  
- Playwright E2E covering: inbox email → tile appears → approve → Safe tx appears.

## Deployment & Testing

### Local E2E
```
# in one terminal
pnpm db:migrate:local
pnpm dev

# second terminal
pnpm playwright install --with-deps
pnpm playwright test tests/tax-autopilot.spec.ts
```
The spec logs in via a mock `mock-privy-did` cookie and walks through the approval flow, asserting that the vault tile flips from "Underfunded" to "Covered".

### Staging Dog-food
1. Set these env vars on Vercel / Railway:
```
NEXT_PUBLIC_BASE_RPC_URL=<base-mainnet-rpc>
APRIVATE_KEY_DOGFOOD1=<owner key of PRIMARY_SAFE>
APRIVATE_KEY_DOGFOOD2=<owner key of SECONDARY_SAFE>
PRIMARY_SAFE_ADDRESS=0x1234567890abcdef1234567890ABCDEF12345678
TAX_SAFE_ADDRESS=0xabcdef1234567890ABCDEF123456789012345678
```
2. Deploy (`pnpm build:remote`).
3. SSH into the container or run a one-off script:
```
pnpm ts-node scripts/dogfood/create-test-data.ts
```
4. Share login link with internal testers; they will see Tax Autopilot widgets on `/dashboard`.