import { Metadata } from 'next';
import Link from 'next/link';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { CreditCard, Ban, ArrowRight, Building, Shield, BellRing, Landmark } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';

export const metadata: Metadata = {
  title: 'Settings - Hypr',
  description: 'Manage your settings and preferences',
};

export default function SettingsPage() {
  return (
    <div className="container max-w-6xl pb-12">
      <PageHeader
        title="Settings"
        description="Manage your accounts, profiles, and preferences"
      />

      <div className="grid gap-6 mt-8 md:grid-cols-2">
        {/* Payment Methods Card */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CreditCard className="h-5 w-5" />
              <span>Funding Sources</span>
            </CardTitle>
            <CardDescription>
              Manage your payment methods and bank connections
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2">
              {/* Virtual bank account setup is now in the onboarding flow on the dashboard */}
              {/* Add more payment method options here */}
            </ul>
            <p className="text-sm text-gray-600">
              Virtual bank account setup is available in your dashboard onboarding flow.
            </p>
          </CardContent>
          <CardFooter>
            <Button variant="outline" className="w-full" asChild>
              <Link href="/settings/funding-sources">
                Manage All Funding Sources
              </Link>
            </Button>
          </CardFooter>
        </Card>

        {/* Security Card */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Shield className="h-5 w-5" />
              <span>Security</span>
            </CardTitle>
            <CardDescription>
              Manage your account security and access
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-gray-600 mb-4">
              Update your wallet connections, recovery options, and access controls.
            </p>
          </CardContent>
          <CardFooter>
            <Button variant="outline" className="w-full">
              Security Settings
            </Button>
          </CardFooter>
        </Card>

        {/* Notifications Card */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BellRing className="h-5 w-5" />
              <span>Notifications</span>
            </CardTitle>
            <CardDescription>
              Manage your notification preferences
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-gray-600 mb-4">
              Control how you receive notifications about invoices, payments, and other events.
            </p>
          </CardContent>
          <CardFooter>
            <Button variant="outline" className="w-full">
              Notification Preferences
            </Button>
          </CardFooter>
        </Card>

        {/* Residence Card */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Landmark className="h-5 w-5" />
              <span>Tax Residence</span>
            </CardTitle>
            <CardDescription>Set your country of tax residence</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-gray-600 mb-4">
              Your residence determines withholding rates for Tax Autopilot.
            </p>
          </CardContent>
          <CardFooter>
            <Button variant="outline" className="w-full" asChild>
              <Link href="/settings/residence">Set Residence</Link>
            </Button>
          </CardFooter>
        </Card>
      </div>
    </div>
  );
} 