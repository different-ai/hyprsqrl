import type { SimplifiedEmail } from './gmail-service';
import { extractInvoiceFromEmailText, AiInvoice } from './ai-service';
import { useInboxStore } from '@/lib/store'; // To update the card in the store
import type { InboxCard } from '@/types/inbox'; // Assuming this now correctly includes parsedInvoiceData, logId, sourceType

/**
 * Processes a single simplified email, extracts invoice data using AI,
 * and updates the corresponding InboxCard in the Zustand store.
 */
export async function processEmailAndExtractInvoice(
  email: SimplifiedEmail,
  // We need a way to get the cardId associated with this email
  // or directly update the card via its email.id (which is store.logId)
): Promise<AiInvoice | null> {
  console.log(`[InvoiceExtractor] Starting extraction for email ID: ${email.id}, Subject: "${email.subject}"`);

  // Combine subject and body for better context, prioritizing textBody
  const emailContent = `${email.subject || ''}\n\n${email.textBody || email.htmlBody || ''}`.trim();

  if (!emailContent) {
    console.warn(`[InvoiceExtractor] Email ID: ${email.id} has no text content to process.`);
    return null;
  }

  try {
    // Ensure subject is string | undefined, not string | null
    const subjectForAI = email.subject === null ? undefined : email.subject;
    const extractedData = await extractInvoiceFromEmailText(emailContent, subjectForAI);

    const cards = useInboxStore.getState().cards;
    // Assuming logId is now part of InboxCard, if not, linter might still complain here
    const cardToUpdate = cards.find(c => (c as InboxCard).logId === email.id && (c as InboxCard).sourceType === 'email');

    if (extractedData && extractedData.confidence >= 80) {
      console.log(`[InvoiceExtractor] Successfully extracted invoice data for email ID: ${email.id} with confidence ${extractedData.confidence}.`);
      if (cardToUpdate) {
        useInboxStore.getState().updateCard(cardToUpdate.id, {
            parsedInvoiceData: extractedData,
            confidence: extractedData.confidence, 
            title: extractedData.invoiceNumber ? `Invoice ${extractedData.invoiceNumber}` : cardToUpdate.title,
        } as Partial<InboxCard>); // Cast to Partial<InboxCard> to satisfy linter for potentially new fields
        console.log(`[InvoiceExtractor] Updated InboxCard ID: ${cardToUpdate.id} with extracted data.`);
      } else {
        console.warn(`[InvoiceExtractor] Could not find InboxCard with logId: ${email.id} to update.`);
      }
      return extractedData;
    } else if (extractedData) {
      console.log(`[InvoiceExtractor] Extraction confidence (${extractedData.confidence}) for email ID: ${email.id} too low or data unsuitable. Card confidence updated.`);
      if (cardToUpdate) {
        useInboxStore.getState().updateCard(cardToUpdate.id, {
             confidence: extractedData.confidence 
        } as Partial<InboxCard>); // Cast for confidence update
      }
      return extractedData; 
    } else {
      console.log(`[InvoiceExtractor] No invoice data extracted for email ID: ${email.id}.`);
      if (cardToUpdate) {
        useInboxStore.getState().updateCard(cardToUpdate.id, { 
            confidence: 10 
        } as Partial<InboxCard>); 
      }
    }
    return null;
  } catch (error) {
    console.error(`[InvoiceExtractor] Error processing email ID: ${email.id}:`, error);
    return null;
  }
}

// Note: We'll need to add `parsedInvoiceData?: AiInvoice;` to the InboxCard type definition. 