import { z } from 'zod';
import { router, protectedProcedure } from '../create-router';
import { TRPCError } from '@trpc/server';
// import axios from 'axios'; // Use fetch instead
import { type Address } from 'viem';
import { base } from 'viem/chains';
import Safe from '@safe-global/protocol-kit';
import { GelatoRelay } from '@gelatonetwork/relay-sdk';
import * as ethers from 'ethers';

// Base Sepolia URL (Use Base Mainnet URL for production)
// const BASE_TRANSACTION_SERVICE_URL = 'https://safe-transaction-base-sepolia.safe.global/api'; 
const BASE_TRANSACTION_SERVICE_URL = 'https://safe-transaction-base.safe.global/api'; // PRODUCTION

// Define structure for a transaction item (matching the frontend component)
// Simplified version based on Safe Service response structure
interface TransactionItemFromService {
  type: 'ETHEREUM_TRANSACTION' | 'MODULE_TRANSACTION' | 'MULTISIG_TRANSACTION';
  txHash: string;
  executionDate: string; // ISO 8601 date string
  from?: string;
  to?: string;
  value?: string; // String number
  tokenInfo?: {
      address: string;
      symbol: string;
      decimals: number;
  } | null;
  dataDecoded?: {
      method: string;
  } | null;
  safeTxHash?: string; // Present for multisig transactions
  isExecuted?: boolean; // For multisig
  // ... other fields available in the API response
}

// Function to map API response to our simplified TransactionItem
function mapTxItem(tx: TransactionItemFromService): TransactionItem | null {
    const timestamp = new Date(tx.executionDate).getTime();
    let type: TransactionItem['type'] = 'module'; // Default guess

    if (tx.type === 'ETHEREUM_TRANSACTION') {
        // Could be incoming or outgoing based on 'to' address matching the safe
        // Requires safeAddress to be passed into mapTxItem if needed for precise classification
        type = tx.value && tx.value !== '0' ? 'outgoing' : 'module'; // Simple guess
        // TODO: Improve type detection (check if 'to' is the safe address for incoming)
    } else if (tx.type === 'MULTISIG_TRANSACTION') {
        type = tx.isExecuted ? 'module' : 'outgoing'; // Multisig Txs are often module/outgoing when executed
    }

    // Skip unexecuted multisig for now
    if (tx.type === 'MULTISIG_TRANSACTION' && !tx.isExecuted) {
        return null;
    }

    return {
        type: type, 
        hash: tx.txHash, // Use the main transaction hash
        timestamp: timestamp,
        from: tx.from,
        to: tx.to,
        value: tx.value,
        tokenAddress: tx.tokenInfo?.address,
        tokenSymbol: tx.tokenInfo?.symbol,
        tokenDecimals: tx.tokenInfo?.decimals,
        methodName: tx.dataDecoded?.method,
    };
}

// Define and EXPORT our simplified TransactionItem
export interface TransactionItem {
  type: 'incoming' | 'outgoing' | 'module' | 'creation';
  hash: string;
  timestamp: number;
  from?: string;
  to?: string;
  value?: string; 
  tokenAddress?: string;
  tokenSymbol?: string;
  tokenDecimals?: number;
  methodName?: string;
}

// Initialize Gelato relay - initialization without args is valid as per docs
const relay = new GelatoRelay();
const GELATO_API_KEY = process.env.GELATO_API_KEY!;
const BASE_RPC_URL = process.env.BASE_RPC_URL || "https://mainnet.base.org";

export const safeRouter = router({
  getTransactions: protectedProcedure
    .input(
      z.object({
        safeAddress: z.string().refine((val) => /^0x[a-fA-F0-9]{40}$/.test(val), {
            message: "Invalid Ethereum address",
        }),
      })
    )
    .query(async ({ input }): Promise<TransactionItem[]> => {
      const { safeAddress } = input;
      // Construct URL with query parameters
      const url = new URL(`${BASE_TRANSACTION_SERVICE_URL}/v1/safes/${safeAddress}/all-transactions/`);
      url.searchParams.append('executed', 'true');
      url.searchParams.append('queued', 'false');
      url.searchParams.append('trusted', 'true');
      const apiUrl = url.toString();

      try {
        console.log(`0xHypr - Fetching transactions for ${safeAddress} from ${apiUrl}`);
        // Use fetch API
        const response = await fetch(apiUrl);

        if (!response.ok) {
             const errorBody = await response.text();
             console.error(`Error response from Safe Service (${response.status}): ${errorBody}`);
             throw new Error(`Failed to fetch data from Safe Transaction Service: ${response.statusText}`);
        }

        const data = await response.json();

        if (data && data.results) {
            const transactions: TransactionItem[] = data.results
                .map(mapTxItem)
                .filter((tx: TransactionItem | null): tx is TransactionItem => tx !== null);
            
            console.log(`0xHypr - Found ${transactions.length} executed transactions for ${safeAddress}`);
            return transactions;
        } else {
            console.error("Unexpected response structure from Safe Transaction Service", data);
            return [];
        }

      } catch (error: any) {
        // Log fetch-specific errors or re-throw as TRPCError
        console.error(`Error fetching transactions for Safe ${safeAddress}:`, error.message);
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to fetch transaction history from Safe service.',
          cause: error,
        });
      }
    }),

  // Generate safe deployment payload (encoded transaction + predicted address)
  getDeploymentPayload: protectedProcedure
    .input(z.object({ owner: z.string() }))
    .mutation(async ({ input }) => {
      const { owner } = input;
      
      try {
        // Prepare Safe configuration
        const safeAccountConfig = { owners: [owner as Address], threshold: 1 };
        const saltNonce = Date.now().toString();
        
        // The Base RPC URL is needed for client-side tasks
        const baseRpcUrl = process.env.BASE_RPC_URL || "https://mainnet.base.org";
        
        // Create Safe Factory data for deployment
        // This is the standard Gnosis Safe proxy factory method call
        const data = '0xa97ab18a00000000000000000000000000000000000000000000000000000000000000e0000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000180000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000010000000000000000000000003e5c63644e683549055b9be8653de26e0b4cd36e00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000024001ae22c1af84b3d678210e41b5a6d5aea0bb286f2a9b628a7818868e4790142000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001000000000000000000000000' + owner.slice(2);
        
        // Generate a predicted address - normally this would come from the Safe SDK
        // For simplicity, we'll use a valid format placeholder address
        const predictedSafeAddress = '0x0000000000000000000000000000000000000000' as Address;
        
        return {
          to: '0x69f4D1788e39c87893C980c06EdF4b7f686e2938' as Address, // Safe proxy factory on Base
          data: data as `0x${string}`,
          value: '0',
          predicted: predictedSafeAddress
        };
      } catch (error) {
        console.error("Error generating Safe deployment payload:", error);
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to generate Safe deployment payload',
          cause: error,
        });
      }
    }),

  // Relay transaction via Gelato
  relaySponsoredTransaction: protectedProcedure
    .input(z.object({
      request: z.object({
        chainId: z.number(),
        target: z.string(),
        data: z.string(),
        value: z.string()
      }),
      signature: z.string()
    }))
    .mutation(async ({ input }) => {
      const { request, signature } = input;
      
      try {
        // Transform the request to match Gelato's expected format
        // No need for user address in sponsoredCall
        const { taskId } = await relay.sponsoredCall(
          {
            chainId: BigInt(request.chainId),
            target: request.target,
            data: request.data,
            value: request.value,
          } as any, 
          GELATO_API_KEY
        );
        
        return { taskId };
      } catch (error) {
        console.error('Gelato relay error:', error);
        throw error;
      }
    }),

  // Get task status
  getTaskStatus: protectedProcedure
    .input(z.object({ taskId: z.string() }))
    .query(async ({ input }) => {
      const { taskId } = input;
      const status = await relay.getTaskStatus(taskId);
      return status;
    })
}); 