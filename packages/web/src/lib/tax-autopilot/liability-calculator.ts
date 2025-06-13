import { db } from '@/db';
import { ledgerEvents } from '@/db/schema';
import { eq } from 'drizzle-orm';

export interface LiabilitySummary {
  totalHeld: number; // in numeric units (same as currency decimals)
  totalReleased: number;
  netLiability: number; // positive = still owed
}

export async function calculateTaxLiability(userDid: string): Promise<LiabilitySummary> {
  const rows = await db
    .select({ type: ledgerEvents.eventType, amount: ledgerEvents.amount })
    .from(ledgerEvents)
    .where(eq(ledgerEvents.userDid, userDid));

  let held = 0;
  let released = 0;
  for (const r of rows) {
    const amt = parseFloat(r.amount);
    if (isNaN(amt)) continue;
    if (r.type === 'tax_hold') held += amt;
    if (r.type === 'tax_release') released += amt;
  }
  return { totalHeld: held, totalReleased: released, netLiability: held - released };
}