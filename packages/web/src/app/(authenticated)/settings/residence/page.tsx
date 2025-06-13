import { Metadata } from 'next';
import { getUserId } from '@/lib/auth';
import { appRouter } from '@/server/routers/_app';
import { db } from '@/db';
import ResidenceForm from '../../../../components/settings/residence-form';
import { PageHeader } from '@/components/layout/page-header';

export const metadata: Metadata = {
  title: 'Residence Settings - Hypr',
};

export default async function ResidenceSettingsPage() {
  const userId = await getUserId();
  if (!userId) return null;

  const caller = appRouter.createCaller({ userId, db, log: console as any });
  const profile = await caller.user.getProfile();

  return (
    <div className="container max-w-lg pb-12 space-y-6">
      <PageHeader title="Tax Residence" description="Select your country of tax residence" />
      <ResidenceForm initialCode={profile.countryCode ?? ''} />
    </div>
  );
}