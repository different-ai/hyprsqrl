import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { router, protectedProcedure } from '../create-router';
import { db } from '../../db';
import { users, userFundingSources, userDestinationBankAccounts, offrampTransfers } from '../../db/schema';
import { alignApi, /* alignOfframpTransferSchema, */ AlignDestinationBankAccount } from '../services/align-api';
import { eq, and } from 'drizzle-orm';
import { getUser } from '@/lib/auth';
import { prepareTokenTransferData, TOKEN_ADDRESSES } from '../services/safe-token-service';
import type { Address } from 'viem';

// Define reusable Zod schema for the bank account object REQUIRED BY ALIGN API
// This is used *internally* now to validate the final payload before sending to Align
const alignDestinationBankAccountSchema = z.object({
    bank_name: z.string().min(1, "Bank name required"),
    account_holder_type: z.enum(['individual', 'business']),
    account_holder_first_name: z.string().optional(),
    account_holder_last_name: z.string().optional(),
    account_holder_business_name: z.string().optional(),
    account_holder_address: z.object({
        country: z.string().min(1, "Country required"),
        city: z.string().min(1, "City required"),
        street_line_1: z.string().min(1, "Street required"),
        postal_code: z.string().min(1, "Postal code required"),
        state: z.string().optional(),
        street_line_2: z.string().optional(),
    }),
    account_type: z.enum(['us', 'iban']),
    iban: z.object({
        bic: z.string().min(1, "BIC required for IBAN"),
        iban_number: z.string().min(1, "IBAN number required"),
    }).optional(),
    us: z.object({
        account_number: z.string().min(1, "Account number required for US"),
        routing_number: z.string().min(1, "Routing number required for US"),
    }).optional(),
}).refine(data => {
    if (data.account_holder_type === 'individual') {
      return !!data.account_holder_first_name && !!data.account_holder_last_name;
    }
    if (data.account_holder_type === 'business') {
      return !!data.account_holder_business_name;
    }
    return false;
}, { message: "First/Last name (Individual) or Business name required.", path: ["accountHolderFirstName"] })
  .refine(data => {
    if (data.account_type === 'us') return !!data.us;
    if (data.account_type === 'iban') return !!data.iban;
    return false;
}, { message: "US details (Account/Routing) or IBAN details (IBAN/BIC) are required based on type.", path: ["accountType"] });

/**
 * Router for Align integration
 * Handles customer creation, KYC verification, and virtual/offramp account management
 */
export const alignRouter = router({
  /**
   * Get customer status from DB
   */
  getCustomerStatus: protectedProcedure.query(async ({ ctx }) => {
    const userFromPrivy = await getUser();
    if (!userFromPrivy?.id) {
      throw new TRPCError({
        code: 'UNAUTHORIZED',
        message: 'User not found',
      });
    }

    // Get user from DB
    const user = await db.query.users.findFirst({
      where: eq(users.privyDid, userFromPrivy.id),
    });

    if (!user) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: 'User not found in database',
      });
    }

    return {
      alignCustomerId: user.alignCustomerId,
      kycStatus: user.kycStatus,
      kycFlowLink: user.kycFlowLink,
      alignVirtualAccountId: user.alignVirtualAccountId,
      kycMarkedDone: user.kycMarkedDone,
    };
  }),

  /**
   * Initiate KYC process
   * Creates a customer in Align if not already created
   */
  initiateKyc: protectedProcedure
    .input(
      z.object({
        firstName: z.string().min(1, 'First name is required'),
        lastName: z.string().min(1, 'Last name is required'),
        businessName: z.string().optional(),
        accountType: z.enum(['individual', 'corporate'])
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userFromPrivy = await getUser();
      const userId = userFromPrivy?.id;
      if (!userId) {
        throw new TRPCError({
          code: 'UNAUTHORIZED',
          message: 'User not found',
        });
      }

      // --- TEST‑KYC SHORT‑CIRCUIT via env var ------------------------------------
      if (process.env.ALIGN_KYC_TEST_MODE === 'true') {
        // Also update the DB for test mode so getCustomerStatus reflects the test link
        try {
          await db
            .update(users)
            .set({
              alignCustomerId: 'test-customer-id',
              kycStatus: 'pending',
              kycFlowLink: 'https://example.com/test-kyc',
              kycProvider: 'align',
            })
            .where(eq(users.privyDid, userId));
          ctx.log?.info({ procedure: 'initiateKyc', userId, testMode: true }, 'Updated DB with test KYC data.');
        } catch (dbError) {
          ctx.log?.error({ procedure: 'initiateKyc', userId, testMode: true, error: (dbError as Error).message }, 'Failed to update DB with test KYC data.');
          // Don't throw here, still return test data to allow frontend testing if DB fails for some reason in test
        }
        return {
          alignCustomerId: 'test-customer-id',
          kycStatus: 'pending' as const, // Ensure type is literal
          kycFlowLink: 'https://example.com/test-kyc',
        };
      }
      // ---------------------------------------------------------------------------

      // Add logging
      const logPayload = { procedure: 'initiateKyc', userId, input };
      ctx.log?.info(logPayload, 'Initiating KYC process...');

      // Get user from DB
      const user = await db.query.users.findFirst({
        where: eq(users.privyDid, userId),
      });

      if (!user) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'User not found in database',
        });
      }

      try {
        // If already has an Align customer ID, refresh status
        if (user.alignCustomerId) {
          const customer = await alignApi.getCustomer(user.alignCustomerId);
          const latestKyc =
            customer.kycs && customer.kycs.length > 0 ? customer.kycs[0] : null; // Safely access kycs array

          if (latestKyc) {
            await db
              .update(users)
              .set({
                kycStatus: latestKyc.status,
                kycFlowLink: latestKyc.kyc_flow_link,
                kycProvider: 'align',
              })
              .where(eq(users.privyDid, userId));

            // Add success logging
            ctx.log?.info({ ...logPayload, result: { alignCustomerId: user.alignCustomerId, status: latestKyc.status } }, 'KYC initiation successful.');

            return {
              alignCustomerId: user.alignCustomerId,
              kycStatus: latestKyc.status,
              kycFlowLink: latestKyc.kyc_flow_link,
            };
          }
        }

        // Extract email from Privy user object
        const email =
          typeof userFromPrivy.email === 'string'
            ? userFromPrivy.email
            : userFromPrivy.email?.address || '';

        // Determine beneficiary type based on input
        const beneficiaryType = input.accountType;

        const customer = await alignApi.createCustomer(
          email,
          input.firstName,
          input.lastName,
          input.businessName, // Pass business name if provided
          beneficiaryType,
        );

        // --- ENSURE KYC SESSION ALWAYS EXISTS ---
        let latestKyc =
          customer.kycs && customer.kycs.length > 0 ? customer.kycs[0] : null;

        // If no KYC session or missing flow link, create one now
        let kycSession = latestKyc;
        if (!latestKyc || !latestKyc.kyc_flow_link) {
          kycSession = await alignApi.createKycSession(customer.customer_id);
        }

        const kycStatusToSet = kycSession?.status ?? 'pending';
        const kycFlowLinkToSet = kycSession?.kyc_flow_link;

        // Update user with new customer ID and KYC status
        await db
          .update(users)
          .set({
            alignCustomerId: customer.customer_id,
            kycStatus: kycStatusToSet,
            kycFlowLink: kycFlowLinkToSet,
            kycProvider: 'align',
          })
          .where(eq(users.privyDid, userId));

        // Add success logging
        ctx.log?.info({ ...logPayload, result: { alignCustomerId: customer.customer_id, status: kycStatusToSet } }, 'KYC initiation successful.');

        return {
          alignCustomerId: customer.customer_id,
          kycStatus: kycStatusToSet,
          kycFlowLink: kycFlowLinkToSet,
        };
      } catch (error) {
        console.error('Error initiating KYC:', error);
        // Add error logging
        ctx.log?.error({ ...logPayload, error: (error as Error).message }, 'KYC initiation failed.');
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `Failed to initiate KYC: ${(error as Error).message}`,
        });
      }
    }),

  /**
   * Refresh KYC status
   * Polls Align API for the latest KYC status
   */
  refreshKycStatus: protectedProcedure.mutation(async ({ ctx }) => {
    const userFromPrivy = await getUser();
    const userId = userFromPrivy?.id;
    if (!userId) {
      throw new TRPCError({
        code: 'UNAUTHORIZED',
        message: 'User not found',
      });
    }

    // Add logging
    const logPayload = { procedure: 'refreshKycStatus', userId };
    ctx.log?.info(logPayload, 'Refreshing KYC status...');

    // Get user from DB
    const user = await db.query.users.findFirst({
      where: eq(users.privyDid, userId),
    });

    if (!user) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: 'User not found in database',
      });
    }

    if (!user.alignCustomerId) {
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: 'User does not have an Align customer ID',
      });
    }

    try {
      const customer = await alignApi.getCustomer(user.alignCustomerId);
      const latestKyc =
        customer.kycs && customer.kycs.length > 0 ? customer.kycs[0] : null; // Safely access kycs array

      if (latestKyc) {
        await db
          .update(users)
          .set({
            kycStatus: latestKyc.status,
            kycFlowLink: latestKyc.kyc_flow_link,
          })
          .where(eq(users.privyDid, userId));



        // Add success logging
        ctx.log?.info({ ...logPayload, result: { alignCustomerId: user.alignCustomerId, status: latestKyc.status } }, 'KYC status refresh successful.');

        return {
          alignCustomerId: user.alignCustomerId,
          kycStatus: latestKyc.status,
          kycFlowLink: latestKyc.kyc_flow_link,
        };
      }

      return {
        alignCustomerId: user.alignCustomerId,
        kycStatus: user.kycStatus,
        kycFlowLink: user.kycFlowLink,
      };
    } catch (error) {
      console.error('Error refreshing KYC status:', error);
      // Add error logging
      ctx.log?.error({ ...logPayload, error: (error as Error).message }, 'KYC status refresh failed.');
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: `Failed to refresh KYC status: ${(error as Error).message}`,
      });
    }
  }),

  /**
   * Request a virtual account
   * Creates a virtual account in Align and stores the details in the database
   */
  requestVirtualAccount: protectedProcedure
    .input(
      z.object({
        sourceCurrency: z.enum(['usd', 'eur']),
        destinationToken: z.enum(['usdc', 'usdt']),
        destinationNetwork: z.enum([
          'polygon',
          'ethereum',
          'base',
          'solana',
          'avalanche',
        ]),
        destinationAddress: z.string().length(42),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userFromPrivy = await getUser();
      if (!userFromPrivy?.id) {
        throw new TRPCError({
          code: 'UNAUTHORIZED',
          message: 'User not found',
        });
      }

      // Get user from DB
      const user = await db.query.users.findFirst({
        where: eq(users.privyDid, userFromPrivy.id),
      });

      if (!user) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'User not found in database',
        });
      }

      if (!user.alignCustomerId) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'User does not have an Align customer ID',
        });
      }

      if (user.kycStatus !== 'approved') {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'User KYC is not approved',
        });
      }

      try {
        // Create virtual account in Align
        console.log(
          'Creating virtual account in Align',
          input.destinationToken,
          input.destinationNetwork,
          input.destinationAddress,
        );
        const virtualAccount = await alignApi.createVirtualAccount(
          user.alignCustomerId,
          {
            source_currency: input.sourceCurrency,
            destination_token: input.destinationToken,
            destination_network: input.destinationNetwork,
            destination_address: input.destinationAddress,
          },
        );

        // Determine account type based on deposit instructions
        let accountType: 'iban' | 'us_ach' = 'us_ach';
        if (virtualAccount.deposit_instructions.iban) {
          accountType = 'iban';
        }

        // Store virtual account details in userFundingSources
        const fundingSource = await db
          .insert(userFundingSources)
          .values({
            userPrivyDid: userFromPrivy.id,
            sourceProvider: 'align',
            alignVirtualAccountIdRef: virtualAccount.id,

            sourceAccountType: accountType,
            sourceCurrency: virtualAccount.source_currency,
            sourceBankName: virtualAccount.deposit_instructions.bank_name,
            sourceBankAddress: virtualAccount.deposit_instructions.bank_address,
            
            // Handle both field naming conventions
            sourceBankBeneficiaryName:
              virtualAccount.deposit_instructions.beneficiary_name || 
              virtualAccount.deposit_instructions.account_beneficiary_name,
            sourceBankBeneficiaryAddress:
              virtualAccount.deposit_instructions.beneficiary_address ||
              virtualAccount.deposit_instructions.account_beneficiary_address,

            // IBAN specific fields
            sourceIban: virtualAccount.deposit_instructions.iban?.iban_number,
            sourceBicSwift: virtualAccount.deposit_instructions.iban?.bic || 
                            virtualAccount.deposit_instructions.bic?.bic_code,

            // ACH specific fields - try both direct fields and nested us object
            sourceAccountNumber:
              virtualAccount.deposit_instructions.us?.account_number ||
              virtualAccount.deposit_instructions.account_number,
            sourceRoutingNumber:
              virtualAccount.deposit_instructions.us?.routing_number ||
              virtualAccount.deposit_instructions.routing_number,

            // Payment rails
            sourcePaymentRails: virtualAccount.deposit_instructions.payment_rails,

            // Destination details
            destinationCurrency: input.destinationToken,
            destinationPaymentRail: input.destinationNetwork,
            destinationAddress: input.destinationAddress,
          })
          .returning();

        // Update user with virtual account ID
        await db
          .update(users)
          .set({
            alignVirtualAccountId: virtualAccount.id,
          })
          .where(eq(users.privyDid, userFromPrivy.id));

        return {
          id: fundingSource[0].id,
          virtualAccountId: virtualAccount.id,
          accountType,
          status: virtualAccount.status,
        };
      } catch (error) {
        console.error('Error requesting virtual account:', error);
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `Failed to request virtual account: ${(error as Error).message}`,
        });
      }
    }),

  /**
   * Get virtual account details
   * Returns the details of the user's virtual account
   */
  getVirtualAccountDetails: protectedProcedure.query(async ({ ctx }) => {
    const userFromPrivy = await getUser();
    if (!userFromPrivy?.id) {
      throw new TRPCError({
        code: 'UNAUTHORIZED',
        message: 'User not found',
      });
    }

    // Get user funding sources from DB
    const fundingSources = await db.query.userFundingSources.findMany({
      where: eq(userFundingSources.userPrivyDid, userFromPrivy.id),
    });

    // Filter for Align-provided sources
    const alignSources = fundingSources.filter(
      (source) => source.sourceProvider === 'align',
    );

    return alignSources;
  }),

  /**
   * Recover customer from Align when they exist in Align but not in our database
   * This is useful when a user has started KYC in Align but the data wasn't saved in our db
   */
  recoverCustomer: protectedProcedure.mutation(async ({ ctx }) => {
    const userFromPrivy = await getUser();
    const userId = userFromPrivy?.id;
    if (!userId) {
      throw new TRPCError({
        code: 'UNAUTHORIZED',
        message: 'User not found',
      });
    }

    // Add logging
    const logPayload = { procedure: 'recoverCustomer', userId };
    ctx.log?.info(logPayload, 'Attempting Align customer recovery...');

    // Get user from DB
    const user = await db.query.users.findFirst({
      where: eq(users.privyDid, userId),
    });

    if (!user) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: 'User not found in database',
      });
    }

    // If already has alignCustomerId, nothing to recover
    if (user.alignCustomerId) {
      // Just refresh the status and return
      const customer = await alignApi.getCustomer(user.alignCustomerId);
      const latestKyc =
        customer.kycs && customer.kycs.length > 0 ? customer.kycs[0] : null;

      if (latestKyc) {
        await db
          .update(users)
          .set({
            kycStatus: latestKyc.status,
            kycFlowLink: latestKyc.kyc_flow_link,
            kycProvider: 'align',
          })
          .where(eq(users.privyDid, userId));

        // Add success logging
        ctx.log?.info({ ...logPayload, result: { recovered: false, alignCustomerId: user.alignCustomerId, status: latestKyc.status } }, 'Align customer recovery successful.');

        return {
          recovered: false, // No recovery needed
          alignCustomerId: user.alignCustomerId,
          kycStatus: latestKyc.status,
          kycFlowLink: latestKyc.kyc_flow_link,
        };
      }
      return {
        recovered: false,
        alignCustomerId: user.alignCustomerId,
        kycStatus: user.kycStatus,
        kycFlowLink: user.kycFlowLink,
      };
    }

    // Extract email from Privy user
    const email =
      typeof userFromPrivy.email === 'string'
        ? userFromPrivy.email
        : userFromPrivy.email?.address || '';

    if (!email) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'User email is required for recovery',
      });
    }

    // Try to find the customer in Align by email
    const customer = await alignApi.searchCustomerByEmail(email);

    if (!customer) {
      // No customer found in Align with this email
      return {
        recovered: false,
        alignCustomerId: null,
        kycStatus: 'none',
        kycFlowLink: null,
      };
    }

    // Customer found in Align! Get full details including KYC info
    const customerDetails = await alignApi.getCustomer(customer.customer_id);
    const latestKyc =
      customerDetails.kycs && customerDetails.kycs.length > 0
        ? customerDetails.kycs[0]
        : null;

    // Update user with recovered customer ID and KYC status
    await db
      .update(users)
      .set({
        alignCustomerId: customer.customer_id,
        kycStatus: latestKyc ? latestKyc.status : 'pending',
        kycFlowLink: latestKyc ? latestKyc.kyc_flow_link : null,
        kycProvider: 'align',
      })
      .where(eq(users.privyDid, userId));



    // Add success logging
    ctx.log?.info({ ...logPayload, result: { recovered: true, alignCustomerId: customer.customer_id, status: latestKyc?.status } }, 'Align customer recovery successful.');

    return {
      recovered: true,
      alignCustomerId: customer.customer_id,
      kycStatus: latestKyc ? latestKyc.status : 'pending',
      kycFlowLink: latestKyc ? latestKyc.kyc_flow_link : null,
    };
  }),

  /**
   * Create a new KYC session
   * This is used when a customer exists but doesn't have an active KYC flow
   */
  createKycSession: protectedProcedure.mutation(async ({ ctx }) => {
    const userFromPrivy = await getUser();
    const userId = userFromPrivy?.id;
    if (!userId) {
      throw new TRPCError({
        code: 'UNAUTHORIZED',
        message: 'User not found',
      });
    }

    // Add logging
    const logPayload = { procedure: 'createKycSession', userId };
    ctx.log?.info(logPayload, 'Creating new KYC session...');

    // Get user from DB
    const user = await db.query.users.findFirst({
      where: eq(users.privyDid, userId),
    });

    if (!user) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: 'User not found in database',
      });
    }

    if (!user.alignCustomerId) {
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: 'User does not have an Align customer ID',
      });
    }

    try {
      // Create a new KYC session in Align
      const kycSession = await alignApi.createKycSession(user.alignCustomerId);

      // Update user with new KYC status and flow link
      await db
        .update(users)
        .set({
          kycStatus: kycSession.status as
            | 'pending'
            | 'none'
            | 'approved'
            | 'rejected',
          kycFlowLink: kycSession.kyc_flow_link,
        })
        .where(eq(users.privyDid, userId));



      // Add success logging
      ctx.log?.info({ ...logPayload, result: { status: kycSession.status } }, 'New KYC session creation successful.');

      return {
        kycStatus: kycSession.status,
        kycFlowLink: kycSession.kyc_flow_link,
      };
    } catch (error) {
      console.error('Error creating KYC session:', error);
      // Add error logging
      ctx.log?.error({ ...logPayload, error: (error as Error).message }, 'New KYC session creation failed.');
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: `Failed to create KYC session: ${(error as Error).message}`,
      });
    }
  }),

  /**
   * Mark that the user has finished their KYC submission steps
   */
  markKycDone: protectedProcedure.mutation(async ({ ctx }) => {
    const userFromPrivy = await getUser();
    const userId = userFromPrivy?.id;
    if (!userId) {
      throw new TRPCError({ code: 'UNAUTHORIZED', message: 'User not found' });
    }

    await db
      .update(users)
      .set({ kycMarkedDone: true })
      .where(eq(users.privyDid, userId));



    return { success: true };
  }),

  /**
   * Unmark the KYC done state (if user clicked by mistake)
   */
  unmarkKycDone: protectedProcedure.mutation(async ({ ctx }) => {
    const userFromPrivy = await getUser();
    const userId = userFromPrivy?.id;
    if (!userId) {
      throw new TRPCError({ code: 'UNAUTHORIZED', message: 'User not found' });
    }

    await db
      .update(users)
      .set({ kycMarkedDone: false })
      .where(eq(users.privyDid, userId));



    return { success: true };
  }),

  // --- OFFRAMP TRANSFER PROCEDURES ---

  /**
   * Create an offramp transfer request in Align.
   * Accepts either a saved bank account ID or manual details from the frontend.
   * Performs validation and constructs the payload for Align API.
   */
  createOfframpTransfer: protectedProcedure
    .input(
      z.union([
        // Option 1: Manual bank account details (less strict input from FE)
        z.object({
            type: z.literal('manual'), // Discriminating literal
            amount: z.string().regex(/^\d+(\.\d{1,2})?$/, "Invalid amount format"), 
            sourceToken: z.enum(['usdc', 'usdt', 'eurc']),
            sourceNetwork: z.enum(['polygon', 'ethereum', 'base', 'tron', 'solana', 'avalanche']),
            destinationCurrency: z.enum(['usd', 'eur', 'mxn', 'ars', 'brl', 'cny', 'hkd', 'sgd']),
            destinationPaymentRails: z.enum(['ach', 'wire', 'sepa', 'swift', 'instant_sepa']),
            destinationSelection: z.string(), // Will be '--manual--'
            bankName: z.string().optional(),
            accountHolderType: z.enum(['individual', 'business']).optional(),
            accountHolderFirstName: z.string().optional(),
            accountHolderLastName: z.string().optional(),
            accountHolderBusinessName: z.string().optional(),
            country: z.string().optional(),
            city: z.string().optional(),
            streetLine1: z.string().optional(),
            streetLine2: z.string().optional(),
            postalCode: z.string().optional(),
            accountType: z.enum(['us', 'iban']).optional(),
            accountNumber: z.string().optional(),
            routingNumber: z.string().optional(),
            ibanNumber: z.string().optional(),
            bicSwift: z.string().optional(), // FE sends bicSwift
        }),
        // Option 2: Saved bank account ID
        z.object({
            type: z.literal('saved'), // Discriminating literal
            amount: z.string().regex(/^\d+(\.\d{1,2})?$/, "Invalid amount format"), 
            sourceToken: z.enum(['usdc', 'usdt', 'eurc']),
            sourceNetwork: z.enum(['polygon', 'ethereum', 'base', 'tron', 'solana', 'avalanche']),
            destinationCurrency: z.enum(['usd', 'eur', 'mxn', 'ars', 'brl', 'cny', 'hkd', 'sgd']),
            destinationPaymentRails: z.enum(['ach', 'wire', 'sepa', 'swift', 'instant_sepa']),
            destinationBankAccountId: z.string().uuid("Invalid saved account ID"), 
        })
      ])
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.user.id;
      const user = await db.query.users.findFirst({ where: eq(users.privyDid, userId) });
      if (!user?.alignCustomerId) { throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'User Align Customer ID not found.' }); }
      if (user.kycStatus !== 'approved') { throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'User KYC must be approved.' }); }
      
      // Access common fields first, as they exist in both union types
      const { amount, sourceToken, sourceNetwork, destinationCurrency, destinationPaymentRails } = input;

      try {
        // Helper function for country code mapping (defined within the mutation scope)
        function mapCountryToISO(countryName: string | null | undefined): string {
            if (!countryName) {
                throw new TRPCError({ code: 'BAD_REQUEST', message: 'Bank account holder country is required.' });
            }
            const lowerCaseCountry = countryName.toLowerCase().trim();
            const mapping: { [key: string]: string } = {
                'united states': 'US',
                'usa': 'US',
                'us': 'US',
                'canada': 'CA',
                'ca': 'CA',
                'belgium': 'BE',
                'be': 'BE',
                // Add more mappings as needed
            };
            const isoCode = mapping[lowerCaseCountry] || countryName;
            return isoCode;
        }
        
        let validatedAlignPayloadBankAccount: AlignDestinationBankAccount;
        let originalBankAccountSnapshot: any; // For DB logging

        // --- Determine Bank Account Details --- \
        if (input.type === 'saved') {
            // Fetch details from DB using the provided ID
            const dbBankAccount = await db.query.userDestinationBankAccounts.findFirst({
                where: and(
                    eq(userDestinationBankAccounts.id, input.destinationBankAccountId),
                    eq(userDestinationBankAccounts.userId, userId) // Ensure ownership
                ),
                // Select columns needed
                columns: {
                    bankName: true,
                    accountHolderType: true,
                    accountHolderBusinessName: true,
                    accountHolderFirstName: true,
                    accountHolderLastName: true,
                    country: true,
                    city: true,
                    streetLine1: true,
                    streetLine2: true,
                    postalCode: true,
                    accountType: true,
                    accountNumber: true, // Assuming it's stored unencrypted or decrypted here
                    routingNumber: true,
                    ibanNumber: true,
                    bicSwift: true // DB uses bicSwift
                }
            });

            if (!dbBankAccount) {
                throw new TRPCError({ code: 'NOT_FOUND', message: 'Saved destination bank account not found or does not belong to user.' });
            }
            originalBankAccountSnapshot = { ...dbBankAccount };

            // Construct the Align payload from DB data
            validatedAlignPayloadBankAccount = {
                bank_name: dbBankAccount.bankName,
                account_holder_type: dbBankAccount.accountHolderType,
                account_holder_address: {
                    country: dbBankAccount.country, // Assume DB stores ISO code or valid name
                    city: dbBankAccount.city,
                    street_line_1: dbBankAccount.streetLine1,
                    postal_code: dbBankAccount.postalCode,
                    ...(dbBankAccount.streetLine2 && { street_line_2: dbBankAccount.streetLine2 })
                },
                account_type: dbBankAccount.accountType,
                ...(dbBankAccount.accountHolderType === 'individual' && {
                    account_holder_first_name: dbBankAccount.accountHolderFirstName ?? undefined,
                    account_holder_last_name: dbBankAccount.accountHolderLastName ?? undefined,
                }),
                ...(dbBankAccount.accountHolderType === 'business' && {
                    account_holder_business_name: dbBankAccount.accountHolderBusinessName ?? undefined,
                }),
                ...(dbBankAccount.accountType === 'us' && {
                    us: {
                        account_number: dbBankAccount.accountNumber!, // Assert non-null based on DB constraints
                        routing_number: dbBankAccount.routingNumber! // Assert non-null
                    }
                }),
                ...(dbBankAccount.accountType === 'iban' && {
                    iban: {
                        iban_number: dbBankAccount.ibanNumber!, // Assert non-null
                        bic: dbBankAccount.bicSwift! // Map bicSwift from DB to bic
                    }
                }),
            };
        } else { // input.type === 'manual'
            // Store for logging
            originalBankAccountSnapshot = { // Capture relevant manual fields
                bankName: input.bankName,
                accountHolderType: input.accountHolderType,
                accountHolderFirstName: input.accountHolderFirstName,
                accountHolderLastName: input.accountHolderLastName,
                accountHolderBusinessName: input.accountHolderBusinessName,
                country: input.country,
                city: input.city,
                streetLine1: input.streetLine1,
                streetLine2: input.streetLine2,
                postalCode: input.postalCode,
                accountType: input.accountType,
                accountNumber: input.accountNumber,
                routingNumber: input.routingNumber,
                ibanNumber: input.ibanNumber,
                bicSwift: input.bicSwift,
            };

            // Construct and VALIDATE the Align payload from manual input
            validatedAlignPayloadBankAccount = {
                bank_name: input.bankName!, // Use non-null assertion, validated by schema below
                account_holder_type: input.accountHolderType!,
                account_holder_address: {
                    country: input.country!, // Use non-null assertion
                    city: input.city!,
                    street_line_1: input.streetLine1!,
                    postal_code: input.postalCode!,
                    ...(input.streetLine2 && { street_line_2: input.streetLine2 })
                },
                account_type: input.accountType!,
                ...(input.accountHolderType === 'individual' && {
                    account_holder_first_name: input.accountHolderFirstName,
                    account_holder_last_name: input.accountHolderLastName,
                }),
                ...(input.accountHolderType === 'business' && {
                    account_holder_business_name: input.accountHolderBusinessName,
                }),
                ...(input.accountType === 'us' && {
                    us: {
                        account_number: input.accountNumber!,
                        routing_number: input.routingNumber!
                    }
                }),
                ...(input.accountType === 'iban' && {
                    iban: {
                        iban_number: input.ibanNumber!,
                        bic: input.bicSwift! // Map bicSwift from input to bic
                    }
                }),
            };
        }
        
        // --- Apply Country Code Mapping (before final validation) ---\
        if (validatedAlignPayloadBankAccount.account_holder_address?.country) {
            validatedAlignPayloadBankAccount.account_holder_address.country = mapCountryToISO(
                validatedAlignPayloadBankAccount.account_holder_address.country
            );
        }

        // --- Final Validation & API Call --- \
        try {
            alignDestinationBankAccountSchema.parse(validatedAlignPayloadBankAccount); // Parse for validation side-effects
        } catch (validationError) {
            console.error("Final bank account payload validation failed:", validationError);
            if (validationError instanceof z.ZodError) {
                throw new TRPCError({
                    code: 'INTERNAL_SERVER_ERROR',
                    message: `Internal Error: Bank account data failed validation: ${validationError.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ')}`,
                    cause: validationError
                });
            } else {
                throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Internal Error: Unexpected error during final bank account validation.' });
            }
        }

        // Use the destructured common fields here
        const alignParams = {
          amount: amount,
          source_token: sourceToken,
          source_network: sourceNetwork,
          destination_currency: destinationCurrency,
          destination_payment_rails: destinationPaymentRails,
          destination_bank_account: validatedAlignPayloadBankAccount, // Use the validated payload
        };

        // Log the exact payload being sent to Align
        console.log('Sending payload to Align createOfframpTransfer:', JSON.stringify(alignParams, null, 2));

        // Create offramp transfer in Align
        const alignTransfer = await alignApi.createOfframpTransfer(
          user.alignCustomerId,
          alignParams
        );

        // Save transfer details to our database
        // Use destructured common fields for DB insert as well
        await db.insert(offrampTransfers).values({
            userId: userId,
            alignTransferId: alignTransfer.id,
            status: alignTransfer.status as any,
            amountToSend: amount,
            destinationCurrency: destinationCurrency,
            destinationPaymentRails: destinationPaymentRails,
            // Store snapshot of bank details used (handle both input types)
            destinationBankAccountSnapshot: JSON.stringify(originalBankAccountSnapshot),
            // Store quote details
            depositAmount: alignTransfer.quote.deposit_amount,
            depositToken: alignTransfer.quote.deposit_token,
            depositNetwork: alignTransfer.quote.deposit_network,
            depositAddress: alignTransfer.quote.deposit_blockchain_address,
            feeAmount: alignTransfer.quote.fee_amount,
            quoteExpiresAt: alignTransfer.quote.expires_at ? new Date(alignTransfer.quote.expires_at) : null,
        });
        
        console.log(`Saved offramp transfer ${alignTransfer.id} to DB for user ${userId}`);

        // Return details needed for the next step
        return {
          alignTransferId: alignTransfer.id,
          status: alignTransfer.status,
          depositAddress: alignTransfer.quote.deposit_blockchain_address,
          depositAmount: alignTransfer.quote.deposit_amount,
          depositNetwork: alignTransfer.quote.deposit_network,
          depositToken: alignTransfer.quote.deposit_token,
          fee: alignTransfer.quote.fee_amount,
          expiresAt: alignTransfer.quote.expires_at,
        };
      } catch (error) {
         console.error('Error creating offramp transfer:', error);
         const message = error instanceof Error ? error.message : 'Unknown error';
         if (error instanceof TRPCError) throw error;
         throw new TRPCError({
           code: 'INTERNAL_SERVER_ERROR',
           message: `Failed to create off-ramp transfer: ${message}`,
           cause: error,
         });
      }
    }),

  /**
   * Complete an offramp transfer in Align & update DB.
   */
  completeOfframpTransfer: protectedProcedure
    .input(z.object({ 
        alignTransferId: z.string(),
        depositTransactionHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/, "Invalid transaction hash"),
    }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.user.id;
      const user = await db.query.users.findFirst({ where: eq(users.privyDid, userId) });
      if (!user?.alignCustomerId) { throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'User Align Customer ID not found.' }); }
      
      // Fetch our internal record first to verify ownership & status
      const internalTransfer = await db.query.offrampTransfers.findFirst({
          where: and(
              eq(offrampTransfers.alignTransferId, input.alignTransferId),
              eq(offrampTransfers.userId, userId)
          )
      });

      if (!internalTransfer) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Off-ramp transfer not found or does not belong to user.' });
      }
      
      // Optional: Check internal status before calling Align (e.g., ensure it's pending)
      // if (internalTransfer.status !== 'pending') { ... }

      try {
        // Complete offramp transfer in Align
        const alignTransfer = await alignApi.completeOfframpTransfer(
          user.alignCustomerId, 
          input.alignTransferId,
          input.depositTransactionHash,
        );

        // Update the transfer status and hash in our database
        await db.update(offrampTransfers)
            .set({
                status: alignTransfer.status as any, // Cast status if needed
                transactionHash: input.depositTransactionHash,
                updatedAt: new Date(),
            })
            .where(eq(offrampTransfers.id, internalTransfer.id)); // Use internal ID

        console.log(`Updated offramp transfer ${internalTransfer.id} in DB. New status: ${alignTransfer.status}`);

        // Return the Align response (or just status)
        return {
          alignTransferId: alignTransfer.id,
          status: alignTransfer.status,
        };
      } catch (error) {
         console.error('Error completing offramp transfer:', error);
         const message = error instanceof Error ? error.message : 'Unknown error';
         if (error instanceof TRPCError) throw error;
         throw new TRPCError({
           code: 'INTERNAL_SERVER_ERROR',
           message: `Failed to complete off-ramp transfer: ${message}`,
           cause: error,
         });
      }
    }),

  /**
   * Get details of a specific offramp transfer (fetches from Align & maybe DB).
   */
  getOfframpTransfer: protectedProcedure
    .input(z.object({ alignTransferId: z.string() }))
    .query(async ({ ctx, input }) => {
        const userId = ctx.user.id;
        const user = await db.query.users.findFirst({ where: eq(users.privyDid, userId) }); // Fetch user
        if (!user?.alignCustomerId) { throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'User Align Customer ID not found.' }); }

        // 1. Verify ownership by checking our DB first
        const internalTransfer = await db.query.offrampTransfers.findFirst({
            where: and(
                eq(offrampTransfers.alignTransferId, input.alignTransferId),
                eq(offrampTransfers.userId, userId)
            ),
            columns: { id: true, status: true } // Only fetch needed columns
        });

        if (!internalTransfer) {
            throw new TRPCError({ code: 'NOT_FOUND', message: 'Off-ramp transfer not found or does not belong to user.' });
        }
        
        // 2. Fetch latest details from Align API
        try {
            const alignTransfer = await alignApi.getOfframpTransfer(
                user.alignCustomerId,
                input.alignTransferId
            );

            // Optional: Update our DB status if Align's is different & status is not final
            const isFinalStatus = ['completed', 'failed', 'canceled'].includes(internalTransfer.status);
            if (!isFinalStatus && internalTransfer.status !== alignTransfer.status) {
                 await db.update(offrampTransfers)
                    .set({ 
                        status: alignTransfer.status as any, // Cast if needed
                        // Potentially update other fields if Align provides them (e.g., failure reason)
                        updatedAt: new Date() 
                    })
                    .where(eq(offrampTransfers.id, internalTransfer.id));
                 console.log(`Synced status for transfer ${internalTransfer.id} to ${alignTransfer.status}`);
            }

            // Return the data fetched from Align (which is the most up-to-date)
            return alignTransfer;

        } catch (error) {
             console.error('Error getting offramp transfer details:', error);
             const message = error instanceof Error ? error.message : 'Unknown error';
             // Handle specific errors e.g., 404 Not Found from Align
             // Type guard for AlignApiError if needed
             // if (error instanceof AlignApiError && error.statusCode === 404) { ... }
             if (error instanceof TRPCError) throw error; // Re-throw known errors
             throw new TRPCError({
                 code: 'INTERNAL_SERVER_ERROR',
                 message: `Failed to get off-ramp transfer details: ${message}`,
                 cause: error,
             });
        }
    }),

  /**
   * Prepares the MetaTransactionData for the user to send funds.
   * Fetches details from our DB first to check status and ownership.
   */
  prepareOfframpTokenTransfer: protectedProcedure
    .input(z.object({ alignTransferId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.user.id;
      // No need to fetch userCustomerId separately if only checking internal DB

      // 1. Fetch internal transfer record for verification & details
       const internalTransfer = await db.query.offrampTransfers.findFirst({
            where: and(
                eq(offrampTransfers.alignTransferId, input.alignTransferId),
                eq(offrampTransfers.userId, userId)
            )
            // Select fields needed for prepareTokenTransferData
            // columns: { status: true, depositToken: true, depositNetwork: true, depositAddress: true, depositAmount: true }
        });

      if (!internalTransfer) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Off-ramp transfer not found or does not belong to user.' });
      }
      
      // 2. Check status - only prepare if pending
      if (internalTransfer.status !== 'pending') {
            throw new TRPCError({ 
                code: 'PRECONDITION_FAILED', 
                message: `Transfer is not in pending state (current: ${internalTransfer.status}). Cannot prepare transaction.` 
            });
      }
      
      // Use stored quote details from our DB
      const quote = internalTransfer; 

      // Check for required quote details
      if (!quote.depositToken || !quote.depositNetwork || !quote.depositAddress || !quote.depositAmount) {
          throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Missing required deposit details in stored transfer record.' });
      }

      try {
        // Prepare the ERC20 transfer data using the service
        const lowerCaseNetwork = quote.depositNetwork.toLowerCase();
        // Validate the network name is a key in TOKEN_ADDRESSES
        if (!(lowerCaseNetwork in TOKEN_ADDRESSES)) {
             throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: `Unsupported network found in stored transfer record: ${quote.depositNetwork}` });
        }

        const tokenTransferData = prepareTokenTransferData({
            tokenSymbol: quote.depositToken,
            tokenNetwork: lowerCaseNetwork as keyof typeof TOKEN_ADDRESSES, // Use validated key
            recipientAddress: quote.depositAddress as Address,
            amount: quote.depositAmount,
        });

        console.log(`Prepared MetaTransactionData for Align transfer ${input.alignTransferId}:`, tokenTransferData);

        return tokenTransferData;

      } catch (error) {
         console.error('Error preparing offramp token transfer:', error);
         const message = error instanceof Error ? error.message : 'Unknown error';
         if (error instanceof TRPCError) throw error;
         throw new TRPCError({
             code: 'INTERNAL_SERVER_ERROR',
             message: `Failed to prepare off-ramp token transfer: ${message}`,
             cause: error,
         });
      }
    }),

  /**
   * Create both USD and EUR virtual accounts for a user in one go.
   * This is a simplified flow triggered from the onboarding card.
   */
  createAllVirtualAccounts: protectedProcedure.mutation(async ({ ctx }) => {
    const userFromPrivy = await getUser();
    const userId = userFromPrivy?.id;
    if (!userId) {
      throw new TRPCError({ code: 'UNAUTHORIZED', message: 'User not found' });
    }

    const logPayload = { procedure: 'createAllVirtualAccounts', userId };
    ctx.log?.info(logPayload, 'Attempting to create all virtual accounts...');

    // 1. Get user from DB and check prerequisites
    const user = await db.query.users.findFirst({
      where: eq(users.privyDid, userId),
    });

    if (!user) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: 'User not found in database',
      });
    }
    if (!user.alignCustomerId) {
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: 'User does not have an Align customer ID.',
      });
    }
    if (user.kycStatus !== 'approved') {
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: 'User KYC is not approved.',
      });
    }

    // 2. Get user's primary safe address
    const primarySafe = await db.query.userSafes.findFirst({
      where: and(eq(userSafes.userDid, userId), eq(userSafes.safeType, 'primary')),
    });

    if (!primarySafe?.safeAddress) {
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: 'Primary safe address not found for the user.',
      });
    }
    const destinationAddress = primarySafe.safeAddress;

    // 3. Define account parameters
    const commonParams = {
      destinationToken: 'usdc' as const,
      destinationNetwork: 'base' as const,
      destinationAddress: destinationAddress,
    };
    const currenciesToCreate: Array<'usd' | 'eur'> = ['usd', 'eur'];
    const results = [];

    // 4. Loop through currencies and create accounts
    for (const currency of currenciesToCreate) {
      try {
        ctx.log?.info({ ...logPayload, currency }, `Creating ${currency} virtual account...`);
        const virtualAccount = await alignApi.createVirtualAccount(
          user.alignCustomerId,
          {
            source_currency: currency,
            destination_token: commonParams.destinationToken,
            destination_network: commonParams.destinationNetwork,
            destination_address: commonParams.destinationAddress,
          },
        );

        let accountType: 'iban' | 'us_ach' = 'us_ach';
        if (virtualAccount.deposit_instructions.iban) {
          accountType = 'iban';
        }

        const fundingSource = await db
          .insert(userFundingSources)
          .values({
            userPrivyDid: userId,
            sourceProvider: 'align',
            alignVirtualAccountIdRef: virtualAccount.id,
            sourceAccountType: accountType,
            sourceCurrency: virtualAccount.source_currency,
            sourceBankName: virtualAccount.deposit_instructions.bank_name,
            sourceBankAddress: virtualAccount.deposit_instructions.bank_address,
            sourceBankBeneficiaryName:
              virtualAccount.deposit_instructions.beneficiary_name ||
              virtualAccount.deposit_instructions.account_beneficiary_name,
            sourceBankBeneficiaryAddress:
              virtualAccount.deposit_instructions.beneficiary_address ||
              virtualAccount.deposit_instructions.account_beneficiary_address,
            sourceIban: virtualAccount.deposit_instructions.iban?.iban_number,
            sourceBicSwift:
              virtualAccount.deposit_instructions.iban?.bic ||
              virtualAccount.deposit_instructions.bic?.bic_code,
            sourceAccountNumber:
              virtualAccount.deposit_instructions.us?.account_number ||
              virtualAccount.deposit_instructions.account_number,
            sourceRoutingNumber:
              virtualAccount.deposit_instructions.us?.routing_number ||
              virtualAccount.deposit_instructions.routing_number,
            sourcePaymentRails: virtualAccount.deposit_instructions.payment_rails,
            destinationCurrency: commonParams.destinationToken,
            destinationPaymentRail: commonParams.destinationNetwork,
            destinationAddress: commonParams.destinationAddress,
          })
          .returning();
        
        // This update is slightly redundant if both succeed, but it's fine.
        await db
          .update(users)
          .set({ alignVirtualAccountId: virtualAccount.id })
          .where(eq(users.privyDid, userId));

        results.push({ success: true, currency, accountId: virtualAccount.id });
        ctx.log?.info({ ...logPayload, currency, result: virtualAccount.id }, `${currency.toUpperCase()} account created successfully.`);

      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        ctx.log?.error({ ...logPayload, currency, error: errorMessage }, `Failed to create ${currency} virtual account.`);
        results.push({ success: false, currency, error: errorMessage });
        // We continue to the next currency even if one fails.
      }
    }

    const successfulCreations = results.filter(r => r.success);
    if (successfulCreations.length === 0) {
        throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message: `Failed to create any virtual accounts. Errors: ${results.map(r => `${r.currency}: ${r.error}`).join(', ')}`,
        });
    }

    return {
        success: true,
        message: `Successfully created ${successfulCreations.length} out of ${currenciesToCreate.length} virtual accounts.`,
        results,
    };
  }),

});
