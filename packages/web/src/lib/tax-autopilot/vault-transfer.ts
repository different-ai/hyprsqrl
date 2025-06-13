import Safe from '@safe-global/protocol-kit';
import { RPC, acct, wc } from '@/lib/safe-client';
import { erc20Abi, encodeFunctionData } from 'viem';

export interface SweepParams {
  safeAddress: `0x${string}`; // user's primary safe
  taxVaultAddress: `0x${string}`; // morpho vault or tax safe
  tokenAddress: `0x${string}`; // USDC token address
  amount: bigint; // wei
}

/**
 * Build and send a Safe transaction that moves `amount` of `tokenAddress`
 * from the user's primary Safe to the dedicated tax vault.
 * Right now, this calls `transfer(address to, uint256 value)` on the ERC20.
 *
 * Returns the submitted tx hash.
 */
export async function sweepToTaxVault({ safeAddress, taxVaultAddress, tokenAddress, amount }: SweepParams) {
  // Init Safe SDK for the user's Safe
  const safe = await Safe.init({ provider: RPC, signer: acct.address, safeAddress });

  // Build ERC20 transfer data
  const data = encodeFunctionData({ abi: erc20Abi, functionName: 'transfer', args: [taxVaultAddress, amount] });

  const tx = await safe.createTransaction({
    onlyCalls: true,
    transactions: [{ to: tokenAddress, data, value: '0' }],
  });

  // Sign and execute in one go (single owner safe assumed)
  const executeResponse = await safe.executeTransaction(tx);
  return executeResponse.hash;
}