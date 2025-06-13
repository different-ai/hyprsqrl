"use client";

import { TaxVaultBalanceTile } from './tax-vault-balance';
import { TaxApprovalCard } from './tax-approval-card';
import { trpc } from '@/utils/trpc';

interface Props {
  safeAddress?: `0x${string}`;
  taxVaultAddress?: `0x${string}`;
  tokenAddress?: `0x${string}`; // USDC on Base
}

export default function TaxAutopilotWidget({ safeAddress, taxVaultAddress, tokenAddress }: Props) {
  const { data } = trpc.tax.getLiability.useQuery();

  const liability = data?.netLiability ?? 0;
  const held = data?.totalHeld ?? 0;
  const missing = liability > held ? liability - held : 0;

  return (
    <div className="space-y-4">
      <TaxVaultBalanceTile />
      {missing > 1 && safeAddress && taxVaultAddress && tokenAddress && (
        <TaxApprovalCard
          suggestedAmount={missing}
          safeAddress={safeAddress}
          taxVaultAddress={taxVaultAddress}
          tokenAddress={tokenAddress}
        />
      )}
    </div>
  );
}