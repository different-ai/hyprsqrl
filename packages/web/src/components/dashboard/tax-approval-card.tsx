"use client";
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { trpc } from '@/utils/trpc';
import { toastSuccess, toastError } from '@/lib/ui/toast';

interface Props {
  suggestedAmount: number; // in USDC units
  safeAddress: `0x${string}`;
  taxVaultAddress: `0x${string}`;
  tokenAddress: `0x${string}`; // USDC address on Base
}

export function TaxApprovalCard({ suggestedAmount, safeAddress, taxVaultAddress, tokenAddress }: Props) {
  const [clicked, setClicked] = useState(false);
  const utils = trpc.useUtils();
  const sweep = trpc.tax.sweep.useMutation({
    onSuccess: () => {
      toastSuccess('Sweep transaction submitted');
      utils.tax.getLiability.invalidate();
    },
    onError: (err) => toastError(err.message),
  });

  const handleApprove = async () => {
    setClicked(true);
    await sweep.mutateAsync({
      safeAddress,
      taxVaultAddress,
      tokenAddress,
      amountWei: (BigInt(Math.floor(suggestedAmount * 1e6))).toString(), // 6 decimals
    }).finally(() => setClicked(false));
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Withhold {suggestedAmount.toLocaleString()} USDC for upcoming taxes</CardTitle>
      </CardHeader>
      <CardContent>
        <Button onClick={handleApprove} disabled={sweep.isPending || clicked}>
          {sweep.isPending ? 'Submitting…' : sweep.data ? 'Sent!' : 'Approve'}
        </Button>
        {sweep.error && <p className="text-rose-600 text-sm mt-2">{sweep.error.message}</p>}
      </CardContent>
    </Card>
  );
}