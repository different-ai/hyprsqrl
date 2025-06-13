import { createPublicClient, createWalletClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { base } from 'viem/chains';

// RPC URL must be set in env VAR
export const RPC = process.env.NEXT_PUBLIC_BASE_RPC_URL!;
if (!RPC) throw new Error('NEXT_PUBLIC_BASE_RPC_URL env var missing');

export const acct = privateKeyToAccount(process.env.aPRIVATE_KEY_OWNER1 as `0x${string}`);

export const pc = createPublicClient({ chain: base, transport: http(RPC) });
export const wc = createWalletClient({ account: acct, chain: base, transport: http(RPC) }) as any;