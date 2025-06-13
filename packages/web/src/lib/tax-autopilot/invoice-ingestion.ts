import { processDocumentFromEmailText } from '@/server/services/ai-service';
import { recordLedgerEvent } from '@/lib/ledger';
import type { NewLedgerEvent } from '@/db/schema';

export interface IngestionOptions {
  userDid: string;
  rawContent: string; // Combined email subject + body or OCR text.
  source?: string; // e.g. 'email', 'pdf_upload'
  relatedInvoiceId?: string; // Optional reference to existing DB invoice
}

export interface IngestionResult {
  xml: string;
  ledgerEventId: string;
  aiConfidence: number;
}

function buildDeterministicXML(data: any): string {
  // Very naive deterministic XML generator for v0
  const safe = (v: any) => (v === null || v === undefined ? '' : String(v));
  return `<?xml version="1.0" encoding="UTF-8"?>\n<Invoice>\n  <Number>${safe(data.invoiceNumber)}</Number>\n  <Buyer>${safe(data.buyerName)}</Buyer>\n  <Seller>${safe(data.sellerName)}</Seller>\n  <Amount currency="${safe(data.currency)}">${safe(data.amount)}</Amount>\n  <IssueDate>${safe(data.issueDate)}</IssueDate>\n  <DueDate>${safe(data.dueDate)}</DueDate>\n</Invoice>`;
}

/**
 * Ingest an invoice-like document, create an income ledger event and return XML.
 */
export async function ingestInvoice(opts: IngestionOptions): Promise<IngestionResult | null> {
  const aiData = await processDocumentFromEmailText(opts.rawContent);
  if (!aiData || aiData.documentType !== 'invoice') return null;

  // Build deterministic XML snapshot
  const xml = buildDeterministicXML(aiData);

  // Record ledger event (income)
  const event: NewLedgerEvent = {
    userDid: opts.userDid,
    eventType: 'income',
    amount: (aiData.amount ?? 0).toString(),
    currency: aiData.currency ?? 'USD',
    relatedInvoiceId: opts.relatedInvoiceId,
    source: opts.source ?? 'invoice_ingestion',
    metadata: {
      xml,
      aiData,
      confidence: aiData.confidence,
    },
  };

  const inserted = await recordLedgerEvent(event);

  return {
    xml,
    ledgerEventId: inserted.id,
    aiConfidence: aiData.confidence,
  };
}