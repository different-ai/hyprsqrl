import { router, publicProcedure } from '../create-router';
import { invoiceRouter } from './invoice-router';
import { fundingSourceRouter } from './funding-source-router';
import { userSafesRouter } from './settings/user-safes';
import { bankAccountsRouter } from './settings/bank-accounts-router';
import { safeRouter } from './safe-router';
import { onboardingRouter } from './onboarding-router';
import { alignRouter } from './align-router';
import { adminRouter } from './admin-router';
import { userRouter } from './user-router';
import { earnRouter } from './earn-router';
import { inboxRouter } from './inbox-router';
import { actionLedgerRouter } from './action-ledger';
import { inboxCardsRouter } from './inbox-cards-router';
import { dashboardRouter } from './dashboard-router';
import { waitlistRouter } from './waitlist-router';
import { taxRouter } from './tax-router';

/**
 * This is the primary router for your server.
 *
 * All routers added in /api/routers should be manually added here.
 */
export const appRouter = router({
  healthcheck: publicProcedure.query(() => 'yay!'),

  invoice: invoiceRouter,
  fundingSource: fundingSourceRouter,
  safe: safeRouter,
  onboarding: onboardingRouter,
  settings: router({
    userSafes: userSafesRouter,
    bankAccounts: bankAccountsRouter,
  }),
  align: alignRouter,
  admin: adminRouter,
  user: userRouter,
  earn: earnRouter,
  inbox: inboxRouter,
  inboxCards: inboxCardsRouter,
  actionLedger: actionLedgerRouter,
  dashboard: dashboardRouter,
  waitlist: waitlistRouter,
  tax: taxRouter,
});

// Export type definition of API
export type AppRouter = typeof appRouter;
