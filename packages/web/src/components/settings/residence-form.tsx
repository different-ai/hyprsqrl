"use client";
import { useState } from 'react';
import { trpc } from '@/utils/trpc';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toastSuccess, toastError } from '@/lib/ui/toast';
import countryCodes from '@/lib/utils/country-codes.json';

interface Props { initialCode: string; }

export default function ResidenceForm({ initialCode }: Props) {
  const [code, setCode] = useState(initialCode);
  const update = trpc.user.updateProfile.useMutation({
    onSuccess: () => toastSuccess('Residence updated'),
    onError: (err) => toastError(err.message),
  });

  const handleSave = () => {
    update.mutate({ countryCode: code });
  };

  return (
    <div className="space-y-4">
      <Select value={code} onValueChange={setCode}>
        <SelectTrigger className="w-full">
          <SelectValue placeholder="Select country" />
        </SelectTrigger>
        <SelectContent>
          {countryCodes.map((c) => (
            <SelectItem key={c.code} value={c.code}>{c.emoji} {c.name}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button onClick={handleSave} disabled={update.isPending || !code} className="w-full">
        {update.isPending ? 'Saving…' : 'Save'}
      </Button>
    </div>
  );
}