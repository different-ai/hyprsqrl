import { db } from '@/db';
import { ledgerEvents, type NewLedgerEvent, type LedgerEvent } from '@/db/schema';
import { ledgerEventBus } from './event-bus';
import { eq, desc } from 'drizzle-orm';

// Initialise downstream listeners (tax rule engine, etc.) via side-effect import
import '@/lib/tax-autopilot/tax-rule-engine';

/**
 * Record a new immutable ledger event and broadcast it on the in-process bus.
 */
export async function recordLedgerEvent(event: NewLedgerEvent): Promise<LedgerEvent> {
  const [inserted] = await db.insert(ledgerEvents).values(event).returning();
  if (inserted) {
    ledgerEventBus.emitEvent(inserted);
  }
  return inserted;
}

/**
 * Get a user's ledger events, newest first.
 */
export async function getLedgerEventsForUser(userDid: string, limit = 100): Promise<LedgerEvent[]> {
  return db
    .select()
    .from(ledgerEvents)
    .where(eq(ledgerEvents.userDid, userDid))
    .orderBy(desc(ledgerEvents.createdAt))
    .limit(limit);
}