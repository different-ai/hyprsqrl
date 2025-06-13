import Safe from '@safe-global/protocol-kit';
import { RPC, acct } from '@/lib/safe-client';
import { encodeFunctionData } from 'viem';

// Minimal ERC4626 ABI for deposit
const erc4626Abi = [
  {
    inputs: [
      { internalType: 'uint256', name: 'assets', type: 'uint256' },
      { internalType: 'address', name: 'receiver', type: 'address' },
    ],
    name: 'deposit',
    outputs: [{ internalType: 'uint256', name: 'shares', type: 'uint256' }],
    stateMutability: 'nonpayable',
    type: 'function',
  },
] as const;

export interface DepositParams {
  safeAddress: `0x${string}`;
  vaultAddress: `0x${string}`; // Morpho vault ERC4626
  tokenAddress: `0x${string}`; // USDC address, must be approved to vault in future version
  amount: bigint; // assets amount (wei)
}

export async function depositToMorphoVault({ safeAddress, vaultAddress, amount }: DepositParams) {
  const safe = await Safe.init({ provider: RPC, signer: acct.address, safeAddress });

  const data = encodeFunctionData({ abi: erc4626Abi, functionName: 'deposit', args: [amount, safeAddress] });

  const tx = await safe.createTransaction({
    onlyCalls: true,
    transactions: [{ to: vaultAddress, data, value: '0' }],
  });

  const response = await safe.executeTransaction(tx);
  return response.hash;
}