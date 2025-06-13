import { ledgerEventBus } from '@/lib/ledger/event-bus';
import { recordLedgerEvent } from '@/lib/ledger';
import type { LedgerEvent, NewLedgerEvent } from '@/db/schema';

// Simple country → withholding pct mapping
const WITHHOLD_PCT_BY_COUNTRY: Record<string, number> = {
  US: 0.25,
  DE: 0.30,
  NL: 0.30,
};

/**
 * Given a ledger event, apply withholding logic and, if needed,
 * record a TAX_HOLD event.
 */
async function handleIncomeEvent(event: LedgerEvent) {
  // TODO: Fetch user country from profile / privy metadata. For v0 assume US.
  const country = (event.metadata as any)?.country || 'US';
  const pct = WITHHOLD_PCT_BY_COUNTRY[country] ?? 0.25;

  // Only USDC supported for now
  if (event.currency !== 'USDC') return;

  // Calculate withheld amount
  const amountNum = parseFloat(event.amount);
  if (isNaN(amountNum) || amountNum <= 0) return;

  const withheld = (amountNum * pct).toFixed(2);

  const taxEvent: NewLedgerEvent = {
    userDid: event.userDid,
    eventType: 'tax_hold',
    amount: withheld,
    currency: event.currency,
    relatedInvoiceId: event.relatedInvoiceId,
    source: 'tax_rule_engine',
    metadata: {
      originalEventId: event.id,
      pct,
      country,
    },
  };

  await recordLedgerEvent(taxEvent);
}

// Initialise listener only once when module is imported.
ledgerEventBus.on('event-recorded', async (event: LedgerEvent) => {
  if (event.eventType === 'income') {
    try {
      await handleIncomeEvent(event);
    } catch (err) {
      console.error('[TaxRuleEngine] error handling income event', err);
    }
  }
});

console.log('[TaxRuleEngine] initialised – Listening for income events');