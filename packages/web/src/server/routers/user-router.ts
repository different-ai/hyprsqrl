import { z } from 'zod';
// import { createTRPCRouter, protectedProcedure } from '@/server/trpc';
import { db } from '@/db';
import { users, userProfilesTable, userSafes } from '@/db/schema';
import { eq, and } from 'drizzle-orm';
import type { Context } from '@/server/context';
import { protectedProcedure, router, publicProcedure } from '../create-router';
import { TRPCError } from '@trpc/server';

// Define input type explicitly for better clarity
const SyncInputSchema = z.object({
  privyUserId: z.string(),
  email: z.string().email().optional(),
  name: z.string().optional(),
});
type SyncInput = z.infer<typeof SyncInputSchema>;

// Helper function to get or create user profile
async function getOrCreateUserProfile(privyDid: string, email?: string) {
  let userProfile = await db.query.userProfilesTable.findFirst({
    where: eq(userProfilesTable.privyDid, privyDid),
  });

  if (!userProfile) {
    if (!email) {
      // Attempt to get email from Privy if not provided (conceptual - requires Privy SDK call)
      // For now, we'll throw if email is essential and missing for a new profile
      console.warn(
        `Email not available for new user profile ${privyDid}, some features might be limited.`,
      );
      // Fallback: create profile without email or make email nullable in schema if appropriate
    }
    const [newUserProfile] = await db
      .insert(userProfilesTable)
      .values({
        privyDid,
        email: email,
        skippedOrCompletedOnboardingStepper: false,
      })
      .returning();
    userProfile = newUserProfile;
    if (!userProfile) {
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to create user profile.',
      });
    }
  }
  return userProfile;
}

export const userRouter = router({
  syncContactToLoops: protectedProcedure
    .input(SyncInputSchema)
    .mutation(async ({ ctx, input }: { ctx: Context; input: SyncInput }) => {
      const { privyUserId, email, name } = input;
      const loopsApiKey = process.env.LOOPS_API_KEY;

      if (!loopsApiKey) {
        console.error(
          'LOOPS_API_KEY is not set. Cannot sync contact to Loops.',
        );
        return { success: false, message: 'Loops API key not configured.' };
      }

      // 1. Check if user exists using privyDid and if already synced
      const user = await db.query.users.findFirst({
        where: eq(users.privyDid, privyUserId),
        columns: {
          loopsContactSynced: true,
        },
      });

      // If user not found in DB yet, or already synced, exit early
      if (!user || user.loopsContactSynced) {
        return { success: true, message: 'User not found or already synced.' };
      }

      // Email is required by Loops
      if (!email) {
        console.warn(
          `Cannot sync user ${privyUserId} to Loops without an email.`,
        );
        return {
          success: false,
          message: 'Email is required to sync contact.',
        };
      }

      try {
        // 2. Call Loops API to create or update contact
        const response = await fetch(
          'https://app.loops.so/api/v1/contacts/create',
          {
            // or /update if preferred
            method: 'POST',
            headers: {
              Authorization: `Bearer ${loopsApiKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              email: email,
              userId: privyUserId, // Use Privy ID as the Loops userId
              firstName: name?.split(' ')[0] ?? '',
              source: 'zero finance app sync',
              joinedAt: new Date().toISOString(),
            }),
          },
        );

        if (!response.ok) {
          const errorBody = await response.text();
          console.error(`Loops API Error (${response.status}): ${errorBody}`);
          throw new Error(
            `Failed to sync contact to Loops (Status: ${response.status})`,
          );
        }

        // 3. Update sync flag in our database using privyDid
        await db
          .update(users)
          .set({ loopsContactSynced: true })
          .where(eq(users.privyDid, privyUserId));

        console.log(
          `Successfully synced contact ${privyUserId} (${email}) to Loops.`,
        );
        return { success: true, message: 'Contact synced successfully.' };
      } catch (error: any) {
        console.error(`Error syncing contact ${privyUserId} to Loops:`, error);
        // Don't update the flag if the API call failed
        // Consider more specific error handling/retries if needed
        return {
          success: false,
          message: error.message || 'Failed to sync contact.',
        };
      }
    }),

  // Get user profile, create if not exists
  getProfile: protectedProcedure.query(async ({ ctx }) => {
    const privyDid = ctx.userId;
    if (!privyDid) {
      throw new TRPCError({ code: 'UNAUTHORIZED' });
    }
    // In a real scenario, you might get the email from ctx.user if Privy provides it
    // For now, this example assumes email might not be directly in ctx.user
    // const email = ctx.user?.email; // Hypothetical: if Privy user object had email
    const userProfile = await getOrCreateUserProfile(privyDid /*, email */);
    return userProfile;
  }),

  // Update user profile (e.g., primary safe address, business name)
  updateProfile: protectedProcedure
    .input(
      z.object({
        primarySafeAddress: z.string().length(42).optional(),
        businessName: z.string().optional(),
        countryCode: z.string().length(2).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const privyDid = ctx.userId;
      if (!privyDid) {
        throw new TRPCError({ code: 'UNAUTHORIZED' });
      }
      await db
        .update(userProfilesTable)
        .set(input)
        .where(eq(userProfilesTable.privyDid, privyDid));
      return { success: true };
    }),

  // Update the user's email address
  updateEmail: protectedProcedure
    .input(z.object({ email: z.string().email() }))
    .mutation(async ({ ctx, input }) => {
      const privyDid = ctx.userId;
      if (!privyDid) {
        throw new TRPCError({ code: 'UNAUTHORIZED' });
      }
      await db
        .update(userProfilesTable)
        .set({ email: input.email, updatedAt: new Date() })
        .where(eq(userProfilesTable.privyDid, privyDid));
      return { success: true };
    }),

  // New procedure to get the primary safe address
  getPrimarySafeAddress: protectedProcedure.query(async ({ ctx }) => {
    const privyDid = ctx.userId;
    if (!privyDid) {
      throw new TRPCError({ code: 'UNAUTHORIZED' });
    }

    const primarySafe = await db.query.userSafes.findFirst({
      where: and(
        eq(userSafes.userDid, privyDid),
        eq(userSafes.safeType, 'primary'),
      ),
      columns: {
        safeAddress: true,
      },
    });

    return { primarySafeAddress: primarySafe?.safeAddress || null };
  }),

  // New procedure to get KYC status
  getKycStatus: protectedProcedure.query(async ({ ctx }) => {
    const privyDid = ctx.userId;
    if (!privyDid) {
      throw new TRPCError({ code: 'UNAUTHORIZED' });
    }
    const user = await db.query.users.findFirst({
      where: eq((users as any).privyDid, privyDid),
      columns: {
        kycStatus: true,
      },
    });
    return { status: (user as any)?.kycStatus || null };
  }),

  // Example: Check if user exists (publicly accessible)
  checkUserExists: publicProcedure
    .input(z.object({ privyDid: z.string() }))
    .query(async ({ input }) => {
      const user = await db.query.users.findFirst({
        where: eq(users.privyDid, input.privyDid),
      });
      return { exists: !!user };
    }),
});
