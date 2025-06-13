import { EventEmitter } from 'events';
import type { LedgerEvent } from '@/db/schema';

// A singleton event emitter so every import gets the same instance
class LedgerEventBus extends EventEmitter {
  emitEvent(event: LedgerEvent) {
    this.emit('event-recorded', event);
  }
}

export const ledgerEventBus = new LedgerEventBus();

export type LedgerEventName = 'event-recorded';