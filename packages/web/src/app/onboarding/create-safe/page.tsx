'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Wallet, X, CheckCircle, ArrowRight, Shield, ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { type Address } from 'viem';
import { base } from 'viem/chains';
import { ethers } from 'ethers';
import { usePrivy, useWallets, useCreateWallet } from '@privy-io/react-auth';
import { GelatoRelay } from '@gelatonetwork/relay-sdk';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { api } from '@/trpc/react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

export default function CreateSafePage() {
  const router = useRouter();
  const { wallets } = useWallets();
  const { user } = usePrivy();
  const { createWallet } = useCreateWallet({
    onSuccess: () => {
      // Reload page after successful wallet creation
      window.location.reload();
    },
    onError: (error) => {
      console.error("Failed to create wallet:", error);
    }
  });
  const embeddedWallet = wallets.find((wallet) => wallet.walletClientType === 'privy');
  const [isLoading, setIsLoading] = useState(false);
  const [deploymentError, setDeploymentError] = useState('');
  const [deployedSafeAddress, setDeployedSafeAddress] = useState<Address | null>(null);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [pollingInterval, setPollingInterval] = useState<NodeJS.Timeout | null>(null);
  const [needsWallet, setNeedsWallet] = useState(false);

  // tRPC mutations and queries
  const getDeploymentPayloadMutation = api.safe.getDeploymentPayload.useMutation();
  const relaySponsoredTransactionMutation = api.safe.relaySponsoredTransaction.useMutation();
  const getTaskStatusQuery = api.safe.getTaskStatus.useQuery(
    { taskId: taskId || '' },
    {
      enabled: !!taskId,
      refetchInterval: taskId ? 5000 : false, // Poll every 5 seconds if we have a taskId
    }
  );
  const completeOnboardingMutation = api.onboarding.completeOnboarding.useMutation();
  const utils = api.useUtils();

  // Check task status and update UI when status changes
  React.useEffect(() => {
    if (taskId && getTaskStatusQuery.data) {
      const status = getTaskStatusQuery.data;
      
      if (status.taskState === 'ExecSuccess') {
        // Task completed successfully
        if (deployedSafeAddress) {
          // If the address is our placeholder, extract the real address from transaction receipt
          let safeAddress = deployedSafeAddress;
          if (deployedSafeAddress.startsWith('0xSafeAddress')) {
            // Get the real address from transaction receipt if available
            if (status.transactionHash) {
              console.log(`Transaction completed with hash: ${status.transactionHash}`);
              // We'll update this later with code to extract the real address
              // For now, let's continue with the placeholder
            }
          }
          
          // Save the address to user profile
          completeOnboardingMutation.mutateAsync({ 
            primarySafeAddress: safeAddress 
          }).then(() => {
            // Invalidate relevant queries to update UI
            utils.settings.userSafes.list.invalidate();
            utils.onboarding.getOnboardingStatus.invalidate();
            
            // Clear loading state
            setIsLoading(false);
            
            // Stop polling
            if (pollingInterval) {
              clearInterval(pollingInterval);
              setPollingInterval(null);
            }
          }).catch((error) => {
            setDeploymentError(`Safe created, but failed to save profile: ${error.message}. Please copy the address and contact support.`);
            setIsLoading(false);
          });
        }
      } else if (status.taskState === 'ExecReverted' || status.taskState === 'Cancelled') {
        // Task failed
        setDeploymentError(`Deployment failed: ${status.taskState}. Please try again.`);
        setIsLoading(false);
        
        // Stop polling
        if (pollingInterval) {
          clearInterval(pollingInterval);
          setPollingInterval(null);
        }
      }
      // For other states (Pending, WaitingForConfirmation, etc.), keep polling
    }
  }, [taskId, getTaskStatusQuery.data, deployedSafeAddress, completeOnboardingMutation, utils, pollingInterval]);

  // Add a useEffect to check for embedded wallet status
  React.useEffect(() => {
    // Check if user has an embedded wallet
    if (!embeddedWallet) {
      setNeedsWallet(true);
    } else {
      setNeedsWallet(false);
    }
  }, [embeddedWallet]);

  const handleCreateSafe = async () => {
    // Check if the user has an embedded wallet
    if (!embeddedWallet) {
      setNeedsWallet(true);
      setDeploymentError("An embedded wallet is required. Please create one by clicking the button below.");
      return;
    }

    setIsLoading(true);
    setDeploymentError('');
    setDeployedSafeAddress(null);
    setTaskId(null);

    try {
      // 1. Switch to Base chain
      try {
        await embeddedWallet.switchChain(base.id);
        console.log(`0xHypr - Switched to Base (Chain ID: ${base.id})`);
      } catch (switchError) {
        console.error("Failed to switch chain:", switchError);
        setDeploymentError(`Failed to switch to Base network. Please switch to Base network in your wallet and try again.`);
        setIsLoading(false);
        return;
      }

      // 2. Get provider after chain switch to ensure it's on Base
      const provider = await embeddedWallet.getEthereumProvider();
      
      // 3. Verify chain ID to ensure we're on Base
      const chainId = await new Promise<number>((resolve) => {
        provider.request({ method: 'eth_chainId' }).then(
          (result: string) => resolve(parseInt(result, 16)),
          (error: any) => {
            console.error("Failed to get chainId:", error);
            setDeploymentError("Failed to verify current chain. Please try again.");
            setIsLoading(false);
            throw error;
          }
        );
      });
      
      if (chainId !== base.id) {
        console.error(`Wrong chain detected. Expected ${base.id}, got ${chainId}`);
        setDeploymentError(`Your wallet is connected to chain ID ${chainId}, but we need Base (${base.id}). Please switch to Base network and try again.`);
        setIsLoading(false);
        return;
      }
      
      console.log(`0xHypr - Confirmed on Base (Chain ID: ${chainId})`);
      
      // 4. Get the user's address for the Safe owner
      const ethersProvider = new ethers.providers.Web3Provider(provider);
      const signer = ethersProvider.getSigner();
      const userAddress = await signer.getAddress() as Address;
      console.log(`0xHypr - User address for Safe owner: ${userAddress}`);

      // 5. Get Safe deployment payload from server
      console.log(`0xHypr - Getting Safe deployment payload...`);
      const payload = await getDeploymentPayloadMutation.mutateAsync({
        owner: userAddress
      });
      console.log(`0xHypr - Safe payload received, predicted address: ${payload.predicted}`);
      
      // 6. Save the predicted Safe address for later
      setDeployedSafeAddress(payload.predicted);
      
      // 7. Prepare request for Gelato relay
      const request = {
        chainId: base.id,
        target: payload.to as Address,
        data: payload.data as `0x${string}`,
        value: payload.value.toString()
      };
      
      // 8. Initialize Gelato relay and prepare Gelato EIP-712 message for signing
      console.log(`0xHypr - Preparing relay request for signature...`);
      // Initialize Gelato relay without configuration - it will use the defaults
      const relay = new GelatoRelay();

      // Manually construct the EIP-712 data for relay
      // Following Gelato's recommended format
      const domain = {
        name: 'GelatoRelayERC2771',
        version: '1',
        chainId,
        verifyingContract: '0xd8253782c45a12053594b9fe356782de4236bf0e'
      };
      
      const types = {
        ForwardRequest: [
          { name: 'chainId', type: 'uint256' },
          { name: 'target', type: 'address' },
          { name: 'data', type: 'bytes' },
          { name: 'value', type: 'uint256' },
        ]
      };
      
      const message = {
        chainId: BigInt(base.id),
        target: request.target,
        data: request.data,
        value: BigInt(request.value),
      };
      
      // 9. Get the user's signature
      console.log(`0xHypr - Requesting user signature...`);
      try {
        const signature = await signer._signTypedData(
          domain,
          types,
          message
        );
        console.log(`0xHypr - Signature received: ${signature.slice(0, 10)}...`);
        
        // 10. Send the relay request to the server
        console.log(`0xHypr - Sending relay request to server...`);
        const { taskId } = await relaySponsoredTransactionMutation.mutateAsync({
          request,
          signature
        });
        console.log(`0xHypr - Relay request sent, taskId: ${taskId}`);
        
        // 11. Set the taskId for polling
        setTaskId(taskId);
      } catch (signError: any) {
        console.error('Error during signature:', signError);
        setDeploymentError(`Failed to sign the transaction: ${signError.message || 'Unknown error'}`);
        setIsLoading(false);
      }

    } catch (error: any) {
      console.error('Error during Safe deployment:', error);
      
      // Extract more specific errors if possible
      let errorMessage = 'An unknown error occurred during Safe deployment.';
      if (error.message?.includes('User rejected the request')) {
        errorMessage = 'Transaction rejected in wallet.';
      } else if (error.shortMessage) {
        errorMessage = error.shortMessage;
      }
      else if (error.message) {
        errorMessage = error.message;
      }
      
      setDeploymentError(errorMessage);
      setIsLoading(false);
    }
  };

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-2xl font-semibold text-[#111827] mb-3">Create Your Primary Safe</h2>
        <p className="text-[#6B7280] text-lg leading-relaxed">
          Your Primary Safe Wallet will be deployed on Base network, a secure and cost-effective Ethereum layer 2 solution.
        </p>
      </div>

      <Card className="border border-[#E5E7EB]">
        <CardContent className="p-6">
          <div className="flex items-start gap-4">
            <div className="mt-1 bg-[#10B981]/10 p-2 rounded-full">
              <Shield className="h-5 w-5 text-[#10B981]" />
            </div>
            <div>
              <h3 className="font-medium text-[#111827] text-lg mb-2">Smart Contract Wallet</h3>
              <p className="text-[#6B7280]">
                We&apos;re creating a Gnosis Safe smart contract wallet for you. This is more secure than a regular wallet
                and allows for advanced features like multi-signature transactions in the future.
              </p>
              
              <div className="mt-4 flex items-center gap-2 text-[#6B7280]">
                <Wallet className="h-5 w-5" />
                <span>Connected Address:</span>
                <code className="bg-[#F9FAFB] px-2 py-0.5 rounded text-xs font-mono border border-[#E5E7EB]">
                  {embeddedWallet?.address ? 
                    `${embeddedWallet.address.slice(0, 6)}...${embeddedWallet.address.slice(-4)}` : 
                    'No wallet connected'
                  }
                </code>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {deploymentError && (
        <Alert variant="destructive" className="my-4 border-red-200 bg-red-50">
          <AlertTitle className="text-red-800 flex items-center gap-2">
            <X className="h-4 w-4" />
            Deployment Error
          </AlertTitle>
          <AlertDescription className="text-red-700 mt-1">
            {deploymentError}
            {deployedSafeAddress && (
              <p className="mt-2">Your Safe was created at <code className="bg-white px-2 py-0.5 rounded text-xs font-mono border border-red-200">{deployedSafeAddress}</code>, but saving failed. Please copy this address and contact support.</p>
            )}
          </AlertDescription>
        </Alert>
      )}

      {needsWallet && (
        <Alert variant="destructive" className="my-4 border-red-200 bg-red-50">
          <AlertTitle className="text-red-800 flex items-center gap-2">
            <X className="h-4 w-4" />
            Wallet Required
          </AlertTitle>
          <AlertDescription className="text-red-700 mt-1">
            <p>You need to create an embedded wallet before deploying a Safe.</p>
            <Button 
              onClick={() => createWallet()}
              className="mt-2 bg-red-600 hover:bg-red-700 text-white"
            >
              Create Embedded Wallet
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {deployedSafeAddress && !deploymentError && getTaskStatusQuery.data?.taskState === 'ExecSuccess' ? (
        <div className="bg-[#F0FDF4] border border-[#86EFAC] rounded-lg p-6">
          <div className="flex items-center mb-3">
            <CheckCircle className="h-6 w-6 text-[#10B981] mr-2" />
            <h3 className="font-medium text-[#111827] text-lg">Safe Successfully Created!</h3>
          </div>
          <p className="text-[#6B7280] mb-3">
            Your Primary Safe Wallet has been deployed to Base network.
          </p>
          <div className="flex items-center gap-2 mb-4">
            <span className="text-[#6B7280]">Safe Address:</span>
            <code className="bg-white px-3 py-1 rounded text-sm font-mono border border-[#E5E7EB] flex-1 break-all">
              {deployedSafeAddress}
            </code>
          </div>
          <p className="text-[#6B7280] text-sm mb-4">
            This address is now linked to your profile. You can proceed to the next step.
          </p>
          <Link
            href="/onboarding/info"
            className="bg-[#111827] hover:bg-[#111827]/90 text-white px-6 py-2.5 rounded-md inline-flex items-center font-medium shadow-sm"
          >
            Continue
            <ArrowRight className="ml-2 h-4 w-4" />
          </Link>
        </div>
      ) : (
        <div className="p-6 bg-[#F9FAFB] rounded-lg border border-[#E5E7EB] flex flex-col items-center">
          {taskId && isLoading ? (
            <div className="text-center mb-6">
              <div className="flex justify-center mb-4">
                <Loader2 className="h-8 w-8 animate-spin text-[#111827]" />
              </div>
              <p className="text-[#6B7280] font-medium">
                Deploying your Safe wallet...
              </p>
              <p className="text-xs text-[#6B7280] mt-2">
                Status: {getTaskStatusQuery.data?.taskState || 'Processing'}
              </p>
              <p className="text-xs text-[#6B7280] mt-1">
                This may take a few minutes. Please don&apos;t close this page.
              </p>
            </div>
          ) : (
            <p className="text-[#6B7280] text-center mb-6">
              Click the button below to create your Primary Safe. We&apos;ll cover the gas fees for you - no ETH needed!
            </p>
          )}
          
          <button
            onClick={handleCreateSafe}
            disabled={isLoading || !embeddedWallet || !!taskId}
            className={`px-8 py-3 text-white rounded-md inline-flex items-center justify-center font-medium shadow-sm ${
              isLoading || !embeddedWallet || !!taskId
                ? 'bg-[#111827]/50 cursor-not-allowed'
                : 'bg-[#111827] hover:bg-[#111827]/90'
            }`}
          >
            {isLoading && !taskId ? (
              <>
                <Loader2 className="h-5 w-5 animate-spin mr-2" />
                Preparing Deployment...
              </>
            ) : (
              <>
                <Shield className="mr-2 h-5 w-5" />
                Deploy Primary Safe on Base
              </>
            )}
          </button>
          
          {!taskId && (
            <p className="mt-4 text-xs text-[#6B7280]">
              Deployment is free - we sponsor the transaction for you! You&apos;ll just need to sign a message.
            </p>
          )}
        </div>
      )}

      <div className="flex justify-between mt-6">
        <Link
          href="/onboarding/welcome"
          className="px-5 py-2 text-[#6B7280] border border-[#E5E7EB] hover:bg-[#F9FAFB] rounded-md inline-flex items-center font-medium transition-colors"
          aria-disabled={isLoading}
          tabIndex={isLoading ? -1 : undefined}
          style={isLoading ? { pointerEvents: 'none', opacity: 0.7 } : undefined}
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back
        </Link>
        
        {(!isLoading && !deployedSafeAddress && !taskId) && (
          <Link
            href="/onboarding/info"
            className="px-4 py-2 text-[#6B7280] border border-[#E5E7EB] hover:bg-[#F9FAFB] rounded-md font-medium transition-colors"
          >
            Skip for Now
          </Link>
        )}
        
        {deployedSafeAddress && !deploymentError && getTaskStatusQuery.data?.taskState === 'ExecSuccess' && (
          <Link
            href="/onboarding/info"
            className="px-6 py-2.5 bg-[#111827] hover:bg-[#111827]/90 text-white rounded-md inline-flex items-center font-medium shadow-sm"
          >
            Next
            <ArrowRight className="ml-2 h-4 w-4" />
          </Link>
        )}
      </div>
    </div>
  );
} 