import { router, protectedProcedure } from '../create-router';
import { z } from 'zod';
import { calculateTaxLiability } from '@/lib/tax-autopilot/liability-calculator';
import { sweepToTaxVault } from '@/lib/tax-autopilot/vault-transfer';

export const taxRouter = router({
  getLiability: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.userId!;
    return calculateTaxLiability(userId);
  }),

  sweep: protectedProcedure
    .input(
      z.object({
        safeAddress: z.string(),
        taxVaultAddress: z.string(),
        tokenAddress: z.string(),
        amountWei: z.string(),
      }),
    )
    .mutation(async ({ input }) => {
      const txHash = await sweepToTaxVault({
        safeAddress: input.safeAddress as `0x${string}`,
        taxVaultAddress: input.taxVaultAddress as `0x${string}`,
        tokenAddress: input.tokenAddress as `0x${string}`,
        amount: BigInt(input.amountWei),
      });
      return { txHash };
    }),
});