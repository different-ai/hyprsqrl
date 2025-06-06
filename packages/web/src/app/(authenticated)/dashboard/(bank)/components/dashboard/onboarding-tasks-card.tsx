'use client';

import React from 'react';
import Link from 'next/link';
import {
  CheckCircle,
  Circle,
  Loader2,
  AlertTriangle,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { api } from '@/trpc/react';
import { toast } from 'sonner';

type OnboardingStepStatus =
  | 'not_started'
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'completed'
  | 'none';

interface OnboardingStep {
  isCompleted: boolean;
  status: OnboardingStepStatus;
  kycMarkedDone?: boolean;
}

interface OnboardingTasksProps {
  initialData?: {
    steps: {
      createSafe: OnboardingStep;
      verifyIdentity: OnboardingStep;
      setupBankAccount: OnboardingStep;
    };
    isCompleted: boolean;
  };
}

export function OnboardingTasksCard({ initialData }: OnboardingTasksProps) {
  const { data: onboardingStatus, isLoading } =
    api.onboarding.getOnboardingSteps.useQuery(undefined, {
      initialData: initialData as any,
      staleTime: 60 * 1000,
      refetchOnWindowFocus: false,
    });

  const utils = api.useUtils();
  const createAccountsMutation = api.align.createAllVirtualAccounts.useMutation({
    onSuccess: (data) => {
      toast.success(data.message || 'Virtual accounts created successfully!');
      utils.align.getVirtualAccountDetails.invalidate();
      utils.onboarding.getOnboardingSteps.invalidate();
    },
    onError: (error) => {
      toast.error(`Failed to create accounts: ${error.message}`);
    },
  });

  if (isLoading) {
    return (
      <Card className="w-full">
        <CardHeader>
          <CardTitle className="text-lg">Setting up your account</CardTitle>
        </CardHeader>
        <CardContent className="flex justify-center items-center py-10">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </CardContent>
      </Card>
    );
  }
  console.log('onboardingStatus', onboardingStatus);

  const kycStep = onboardingStatus?.steps?.verifyIdentity;
  const bankAccountStep = onboardingStatus?.steps?.setupBankAccount;

  if (
    !onboardingStatus ||
    (kycStep?.isCompleted && bankAccountStep?.isCompleted)
  ) {
    return null;
  }

  const isKycComplete = kycStep?.isCompleted ?? false;
  const kycStatus = kycStep?.status;
  const kycMarkedDone = kycStep?.kycMarkedDone ?? false;
  const isBankAccountComplete = bankAccountStep?.isCompleted ?? false;

  let kycContent;

  if (isKycComplete) {
    kycContent = {
      icon: <CheckCircle className="h-6 w-6 text-green-500" />,
      title: 'Identity Verified',
      description: 'Your identity has been successfully verified.',
      button: null,
    };
  } else if (kycStatus === 'rejected') {
    kycContent = {
      icon: <AlertTriangle className="h-6 w-6 text-red-500" />,
      title: 'Action Required',
      description:
        'There was an issue with your identity verification. Please review the details and resubmit.',
      button: (
        <Button asChild size="sm">
          <Link href="/onboarding/kyc">Retry Verification</Link>
        </Button>
      ),
    };
  } else if (kycMarkedDone) {
    // User marked as done, but status is still pending.
    kycContent = {
      icon: <Loader2 className="h-6 w-6 animate-spin text-blue-500" />,
      title: 'Verification in Review',
      description:
        "You've marked your KYC as complete. We are actively reviewing your submission, which usually takes up to 24 hours. If you made a mistake, you can go back and correct it.",
      button: (
        <Button asChild size="sm" variant="outline">
          <Link href="/onboarding/kyc">Check Status or Correct</Link>
        </Button>
      ),
    };
  } else {
    // KYC not done, not rejected, and not marked as complete by user.
    kycContent = {
      icon: <Circle className="h-6 w-6 text-gray-400" />,
      title: 'Verify Your Identity',
      description:
        'Hey, you need to complete KYC. Click the link to go to our onboarding page and finish the process.',
      button: (
        <Button asChild size="sm">
          <Link href="/onboarding/kyc">Complete KYC</Link>
        </Button>
      ),
    };
  }

  const handleCreateAccounts = () => {
    createAccountsMutation.mutate();
  };

  const bankAccountContent = {
    disabled: !isKycComplete || createAccountsMutation.isPending,
    icon: !isKycComplete ? (
      <Circle className="h-6 w-6 text-gray-400" />
    ) : isBankAccountComplete ? (
      <CheckCircle className="h-6 w-6 text-green-500" />
    ) : createAccountsMutation.isPending ? (
      <Loader2 className="h-6 w-6 animate-spin text-blue-500" />
    ) : (
      <Circle className="h-6 w-6 text-gray-400" />
    ),
    title: 'Create Virtual Bank Account',
    description: !isKycComplete
      ? 'Complete identity verification to unlock this step.'
      : isBankAccountComplete
        ? 'Your virtual bank account is set up and ready to use.'
        : "Set up virtual bank accounts to receive both USD (ACH/Wire) and EUR (IBAN) payments that auto-convert to USDC.",
    button:
      isKycComplete && !isBankAccountComplete ? (
        <Button
          size="sm"
          onClick={handleCreateAccounts}
          disabled={createAccountsMutation.isPending || !isKycComplete}
        >
          {createAccountsMutation.isPending && (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          )}
          Set Up Accounts
        </Button>
      ) : null,
  };

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle className="text-lg">Finish setting up your account</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Step 1: Verify Identity */}
        <div className="flex items-start gap-4">
          <div className="flex-shrink-0 mt-1">{kycContent.icon}</div>
          <div className="flex-1">
            <p className="font-semibold text-gray-800">{`1. ${kycContent.title}`}</p>
            <p className="text-sm text-gray-600">{kycContent.description}</p>
          </div>
          {kycContent.button && (
            <div className="flex-shrink-0">{kycContent.button}</div>
          )}
        </div>

        {/* Step 2: Create Virtual Bank Account */}
        <div
          className={`flex items-start gap-4 ${
            bankAccountContent.disabled ? 'opacity-50' : ''
          }`}
        >
          <div className="flex-shrink-0 mt-1">{bankAccountContent.icon}</div>
          <div className="flex-1">
            <p className="font-semibold text-gray-800">{`2. ${bankAccountContent.title}`}</p>
            <p className="text-sm text-gray-600">
              {bankAccountContent.description}
            </p>
          </div>
          {bankAccountContent.button && (
            <div className="flex-shrink-0">{bankAccountContent.button}</div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
