'use client';

import { useEffect, useState, useCallback } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import { getUserFundingSources, type UserFundingSourceDisplayData } from '@/actions/get-user-funding-sources';
import { getUnmaskedSourceIdentifier, type UnmaskedSourceIdentifier } from '@/actions/get-unmasked-source-identifier';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Banknote, Link2, ExternalLink, Eye, EyeOff, Loader2 } from 'lucide-react';
import { Button } from "@/components/ui/button";

// Define a type for the revealed details state, matching backend
// It's good practice to keep frontend types aligned with backend potentially in a shared types package later
type RevealedSourceDetails = {
  identifier: string;
  routingNumber?: string; 
  type: 'us_ach' | 'iban' | 'uk_details' | 'other';
} | null; // Allow null for cases where fetch might fail or not applicable

export function FundingSourceDisplay() {
  const { ready, authenticated, user } = usePrivy();
  const [fundingSources, setFundingSources] = useState<UserFundingSourceDisplayData[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Use the specific type for revealed details state
  const [revealedSourceDetails, setRevealedSourceDetails] = useState<Record<string, RevealedSourceDetails>>({});
  const [revealingSourceId, setRevealingSourceId] = useState<string | null>(null);

  useEffect(() => {
    async function fetchSources() {
      if (ready && authenticated && user?.id) {
        setIsLoading(true);
        setError(null);
        try {
          const sources = await getUserFundingSources(user.id);
          setFundingSources(sources);
        } catch (err) {
          console.error("Failed to fetch funding sources:", err);
          setError("Failed to load funding information.");
        } finally {
          setIsLoading(false);
        }
      } else if (ready && !authenticated) {
        // If ready but not authenticated, stop loading
        setIsLoading(false);
        setFundingSources([]); // Clear any stale data
      }
    }

    fetchSources();
  }, [ready, authenticated, user?.id]);

  const handleToggleReveal = useCallback(async (sourceId: string) => {
    if (revealedSourceDetails[sourceId]) {
      setRevealedSourceDetails(prev => {
        const newState = { ...prev };
        delete newState[sourceId];
        return newState;
      });
    } else {
      setRevealingSourceId(sourceId);
      setError(null);
      try {
        // Fetch the full unmasked details object - casting the result to the expected type
        const unmaskedData = await getUnmaskedSourceIdentifier(sourceId) as RevealedSourceDetails;
        if (unmaskedData) {
          setRevealedSourceDetails(prev => ({ ...prev, [sourceId]: unmaskedData }));
        } else {
          setError(`Could not retrieve details for this source. Please try again.`);
          console.error('Failed to get unmasked identifier, action returned null');
        }
      } catch (err) {
        setError("An error occurred while retrieving source details.");
        console.error("Error calling getUnmaskedSourceIdentifier:", err);
      } finally {
        setRevealingSourceId(null);
      }
    }
  }, [revealedSourceDetails]);

  // Display Skeleton while loading
  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-1/2" />
          <Skeleton className="h-4 w-3/4" />
        </CardHeader>
        <CardContent className="space-y-4">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </CardContent>
      </Card>
    );
  }

  // Display error message if fetch failed
  if (error) {
    return (
      <Card className="border-destructive">
        <CardHeader>
          <CardTitle className="text-destructive">Error</CardTitle>
          <CardDescription>{error}</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  // Do not render if not authenticated and not loading, or if no sources exist
  if ((!authenticated && !isLoading) || fundingSources.length === 0) {
    return null;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Linked Accounts</CardTitle>
        <CardDescription>Manage your connected bank accounts and crypto addresses.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {fundingSources.map((source) => {
          const revealedDetails = revealedSourceDetails[source.id];
          const isRevealed = !!revealedDetails;
          const isRevealing = revealingSourceId === source.id;

          return (
            <div key={source.id} className="border p-4 rounded-md bg-card shadow-sm">
              {/* Header Row: Icon, Name/Masked ID/Address, Reveal Button, Rail */}
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2 flex-grow min-w-0">
                  {/* Icon based on type */}
                  {source.sourceBankName ? <Banknote className="h-5 w-5 text-primary flex-shrink-0" /> : <Link2 className="h-5 w-5 text-primary flex-shrink-0" />}
                  
                  {/* Name / Masked ID / Short Address (Unrevealed) */}
                  {!isRevealed && (
                     <span className="text-sm font-medium truncate">
                      {source.sourceBankName ? 
                        `${source.sourceBankName} ${source.sourceIdentifier}` : 
                        source.destinationAddress /* shortenAddress(source.destinationAddress || '') */}
                     </span>
                  )}

                  {/* Bank Name + Type (Revealed) */} 
                  {isRevealed && source.sourceBankName && (
                    <span className="text-sm font-medium truncate">
                      {source.sourceBankName} 
                      <span className="text-xs text-muted-foreground ml-1">({source.sourceAccountType.replace('_', ' ').toUpperCase()})</span>
                    </span>
                  )}
                  
                   {/* Crypto Currency (Revealed) */} 
                  {isRevealed && source.destinationAddress && (
                    <span className="text-sm font-medium truncate">
                       {source.destinationCurrency?.toUpperCase()}
                    </span>
                  )}

                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                   {/* Payment Rail (always visible) */} 
                  <span className="text-xs text-muted-foreground capitalize">
                     {source.sourcePaymentRail?.replace('_', ' ') || source.destinationPaymentRail}
                  </span>
                   {/* Reveal Button */} 
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 p-0"
                    onClick={() => handleToggleReveal(source.id)}
                    disabled={isRevealing}
                    aria-label={isRevealed ? "Hide details" : "Show details"}
                  >
                    {isRevealing ? <Loader2 className="h-4 w-4 animate-spin" /> : (isRevealed ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />)}
                  </Button>
                </div>
              </div>

              {/* Revealed Details Section */} 
              {isRevealed && revealedDetails && (
                <div className="border-t pt-3 mt-3 space-y-2 text-sm">
                  {/* Bank Account Details */} 
                  {revealedDetails.type === 'us_ach' && (
                    <>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Account Number:</span>
                        <span className="font-mono">{revealedDetails.identifier}</span>
                      </div>
                      {revealedDetails.routingNumber && (
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Routing Number:</span>
                          <span className="font-mono">{revealedDetails.routingNumber}</span>
                        </div>
                      )}
                    </>
                  )}
                  {/* IBAN Details */} 
                  {revealedDetails.type === 'iban' && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">IBAN:</span>
                      <span className="font-mono">{revealedDetails.identifier}</span>
                    </div>
                  )}
                  
                </div>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
} 