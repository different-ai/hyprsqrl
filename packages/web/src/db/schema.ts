import { pgTable, text, timestamp, varchar, uuid, boolean, jsonb, bigint, primaryKey, uniqueIndex, index, integer } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import crypto from 'crypto';

// Define specific types for role and status for better type safety
export type InvoiceRole = 'seller' | 'buyer';
export type InvoiceStatus = 
  | 'pending'          // Invoice is committed to Request Network and awaiting payment
  | 'paid'             // Invoice has been paid
  | 'db_pending'       // Invoice is only saved in the database, not yet committed to Request Network
  | 'committing'       // Invoice is in the process of being committed to Request Network
  | 'failed'           // Invoice failed to commit to Request Network
  | 'canceled';        // Invoice has been canceled

// Removed: ephemeralKeysTable definition
/*
export const ephemeralKeysTable = pgTable("ephemeral_keys", {
  token: varchar("token", { length: 255 }).primaryKey(),
  privateKey: text("private_key").notNull(),
  publicKey: text("public_key").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  expiresAt: timestamp("expires_at").notNull(),
});
*/

export const userWalletsTable = pgTable("user_wallets", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: varchar("user_id", { length: 255 }).notNull(),
  address: varchar("address", { length: 255 }).notNull().unique(),
  privateKey: text("private_key").notNull(),
  publicKey: text("public_key").notNull(),
  network: varchar("network", { length: 50 }).notNull().default("gnosis"),
  isDefault: boolean("is_default").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const userProfilesTable = pgTable("user_profiles", {
  id: uuid("id").defaultRandom().primaryKey(),
  privyDid: varchar("privy_did", { length: 255 }).notNull().unique(),
  paymentAddress: varchar("payment_address", { length: 255 }),
  businessName: varchar("business_name", { length: 255 }),
  email: varchar("email", { length: 255 }).notNull(),
  defaultWalletId: uuid("default_wallet_id").references(() => userWalletsTable.id),
  hasCompletedOnboarding: boolean("has_completed_onboarding").default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// New table for user settings/preferences
export const userSettingsTable = pgTable("user_settings", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => userProfilesTable.id).unique(), // One settings row per user
  showAddresses: boolean("show_addresses").default(false).notNull(), // Default to hiding addresses
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull().$onUpdate(() => new Date()),
});

export const userRequestsTable = pgTable("user_requests", {
  id: text('id').primaryKey().default(crypto.randomUUID()), // Using text for UUIDs
  requestId: text('request_id'), // Request Network ID
  userId: text('user_id').notNull(),
  walletAddress: text('wallet_address'), // Wallet address used for the request
  role: text('role').$type<InvoiceRole>(),
  description: text('description'),
  amount: bigint('amount', { mode: 'bigint' }), // Stored as bigint (smallest unit)
  currency: text('currency'),
  currencyDecimals: integer('currency_decimals'), // Store the decimals used for the amount
  status: text('status').$type<InvoiceStatus>().default('db_pending'), // Default to db_pending
  client: text('client'),
  invoiceData: jsonb('invoice_data').notNull(), // Store the full validated Zod object (Use jsonb)
  // Removed: shareToken: text('share_token'), // Removed field for the ephemeral share token
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// Define relations between tables
export const userProfilesRelations = relations(userProfilesTable, ({ one }) => ({
  defaultWallet: one(userWalletsTable, {
    fields: [userProfilesTable.defaultWalletId],
    references: [userWalletsTable.id],
  }),
}));

export const userWalletsRelations = relations(userWalletsTable, ({ many }) => ({
  profiles: many(userProfilesTable),
}));

// Type inference
// Removed: EphemeralKey types
// export type EphemeralKey = typeof ephemeralKeysTable.$inferSelect;
// export type NewEphemeralKey = typeof ephemeralKeysTable.$inferInsert;

export type UserWallet = typeof userWalletsTable.$inferSelect;
export type NewUserWallet = typeof userWalletsTable.$inferInsert;

export type UserProfile = typeof userProfilesTable.$inferSelect;
export type NewUserProfile = typeof userProfilesTable.$inferInsert;

export const companyProfilesTable = pgTable("company_profiles", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => userProfilesTable.id),
  businessName: varchar("business_name", { length: 255 }).notNull(),
  // Contact information
  email: varchar("email", { length: 255 }),
  phone: varchar("phone", { length: 50 }),
  website: varchar("website", { length: 255 }),
  // Business details
  taxRegistration: varchar("tax_registration", { length: 100 }),
  registrationNumber: varchar("registration_number", { length: 100 }),
  industryType: varchar("industry_type", { length: 100 }),
  // Address
  streetAddress: varchar("street_address", { length: 255 }),
  city: varchar("city", { length: 100 }),
  region: varchar("region", { length: 100 }),
  postalCode: varchar("postal_code", { length: 50 }),
  country: varchar("country", { length: 100 }),
  // Logo and branding
  logoUrl: varchar("logo_url", { length: 500 }),
  brandColor: varchar("brand_color", { length: 50 }),
  // Additional information
  isDefault: boolean("is_default").default(true),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Define relations for company profiles
export const companyProfilesRelations = relations(companyProfilesTable, ({ one }) => ({
  userProfile: one(userProfilesTable, {
    fields: [companyProfilesTable.userId],
    references: [userProfilesTable.id],
  }),
}));

export type UserRequest = typeof userRequestsTable.$inferSelect;
export type NewUserRequest = typeof userRequestsTable.$inferInsert;

export type CompanyProfile = typeof companyProfilesTable.$inferSelect;
export type NewCompanyProfile = typeof companyProfilesTable.$inferInsert;

// --- IMPORTED FROM BANK ---

// Users table - Storing basic user info, identified by Privy DID
export const users = pgTable('users', {
  privyDid: text('privy_did').primaryKey(), // Privy Decentralized ID
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  // Align-specific fields
  alignCustomerId: text('align_customer_id').unique(), // Customer ID from Align API
  kycProvider: text('kyc_provider', { enum: ['align', 'other'] }), // KYC provider
  kycStatus: text('kyc_status', { enum: ['none', 'pending', 'approved', 'rejected'] }).default('none'), // KYC status
  kycFlowLink: text('kyc_flow_link'), // Link to KYC flow
  alignVirtualAccountId: text('align_virtual_account_id'), // Virtual account ID from Align
  // Flag to track if contact has been sent to Loops
  loopsContactSynced: boolean('loops_contact_synced').default(false).notNull(),
});

// UserSafes table - Linking users to their various Safe addresses
export const userSafes = pgTable('user_safes', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()), // Unique ID for the safe record
  userDid: text('user_did').notNull().references(() => users.privyDid), // Foreign key to users table
  safeAddress: varchar('safe_address', { length: 42 }).notNull(), // Ethereum address (42 chars)
  safeType: text('safe_type', { enum: ['primary', 'tax', 'liquidity', 'yield'] }).notNull(), // Type of Safe
  isEarnModuleEnabled: boolean('is_earn_module_enabled').default(false).notNull(), // Tracks if the earn module is enabled
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => {
  return {
    // Ensure a user can only have one Safe of each type
    userTypeUniqueIdx: uniqueIndex('user_safe_type_unique_idx').on(table.userDid, table.safeType),
  };
});

// AllocationStates table - Storing allocation data per primary Safe
export const allocationStates = pgTable('allocation_states', {
  userSafeId: text('user_safe_id').notNull().references(() => userSafes.id), // Foreign key to the specific primary user safe
  lastCheckedUSDCBalance: text('last_checked_usdc_balance').default('0').notNull(), // Storing as text to handle large numbers (wei)
  totalDeposited: text('total_deposited').default('0').notNull(),        // Storing as text
  allocatedTax: text('allocated_tax').default('0').notNull(),          // Storing as text
  allocatedLiquidity: text('allocated_liquidity').default('0').notNull(),    // Storing as text
  allocatedYield: text('allocated_yield').default('0').notNull(),        // Storing as text
  pendingDepositAmount: text('pending_deposit_amount').default('0').notNull(), // Storing as text
  lastUpdated: timestamp('last_updated', { withTimezone: true }).defaultNow().notNull(),
}, (table) => {
  return {
    // Make userSafeId the primary key, as each primary safe has one state
    pk: primaryKey({ columns: [table.userSafeId] }),
  };
});

// UserFundingSources table - Storing linked bank accounts and crypto destinations
export const userFundingSources = pgTable('user_funding_sources', {
  id: uuid('id').primaryKey().defaultRandom(),
  userPrivyDid: text('user_privy_did').notNull().references(() => users.privyDid, { onDelete: 'cascade' }),

  // Source Provider
  sourceProvider: text('source_provider', { enum: ['align', 'manual', 'other'] }), // Provider of the funding source
  alignVirtualAccountIdRef: text('align_virtual_account_id_ref'), // Reference to Align virtual account ID

  // Source Bank Account Details
  sourceAccountType: text('source_account_type', { enum: ['us_ach', 'iban', 'uk_details', 'other'] }).notNull(), // Type identifier - Reverted to NOT NULL
  sourceCurrency: text('source_currency'),
  sourceBankName: text('source_bank_name'),
  sourceBankAddress: text('source_bank_address'), // Optional general address
  sourceBankBeneficiaryName: text('source_bank_beneficiary_name'),
  sourceBankBeneficiaryAddress: text('source_bank_beneficiary_address'), // Beneficiary's address

  // Type-Specific Identifiers (nullable)
  sourceIban: text('source_iban'), // International Bank Account Number - NEW
  sourceBicSwift: text('source_bic_swift'), // Bank Identifier Code - NEW
  sourceRoutingNumber: text('source_routing_number'), // US ABA routing transit number - Now nullable
  sourceAccountNumber: text('source_account_number'), // US / UK account number - Now nullable
  sourceSortCode: text('source_sort_code'), // UK Sort Code - NEW

  // Payment Rails
  sourcePaymentRail: text('source_payment_rail'), // Primary rail used/intended (e.g., ach_push, sepa_credit, faster_payments)
  sourcePaymentRails: text('source_payment_rails').array(), // All supported rails

  // Destination Details (remains the same)
  destinationCurrency: text('destination_currency'),
  destinationPaymentRail: text('destination_payment_rail'),
  destinationAddress: varchar('destination_address', { length: 42 }),

  // Timestamps
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull().$onUpdate(() => new Date()),
}, (table) => {
  return {
    // Add index on user privy did for faster lookups
    userDidIdx: index('user_funding_sources_user_did_idx').on(table.userPrivyDid), // Added index
  };
});

// Destination Bank Accounts table - Storing bank accounts for offramp transfers
export const userDestinationBankAccounts = pgTable('user_destination_bank_accounts', {
  id: uuid('id').primaryKey().defaultRandom(), // Changed from serial to uuid for consistency
  userId: text('user_id').notNull().references(() => users.privyDid, { onDelete: 'cascade' }), // Link to user's privy DID
  accountName: text('account_name').notNull(), // Nickname for the account
  bankName: text('bank_name').notNull(),
  accountHolderType: text('account_holder_type', { enum: ['individual', 'business'] }).notNull(),
  accountHolderFirstName: text('account_holder_first_name'),
  accountHolderLastName: text('account_holder_last_name'),
  accountHolderBusinessName: text('account_holder_business_name'),
  
  // Address
  country: text('country').notNull(),
  city: text('city').notNull(),
  streetLine1: text('street_line_1').notNull(),
  streetLine2: text('street_line_2'),
  postalCode: text('postal_code').notNull(),
  
  // Account type
  accountType: text('account_type', { enum: ['us', 'iban'] }).notNull(),
  
  // US-specific fields (potentially encrypt these in the future)
  accountNumber: text('account_number'), 
  routingNumber: text('routing_number'), 
  
  // IBAN-specific fields (potentially encrypt iban_number)
  ibanNumber: text('iban_number'), 
  bicSwift: text('bic_swift'),
  
  isDefault: boolean('is_default').default(false).notNull(), // Added notNull constraint
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull().$onUpdate(() => new Date()), // Added $onUpdate
}, (table) => {
  return {
    userDidIdx: index('user_dest_bank_accounts_user_id_idx').on(table.userId), // Added index
  };
});

// New table for Allocation Strategies
export const allocationStrategies = pgTable('allocation_strategies', {
  id: uuid('id').primaryKey().defaultRandom(),
  userDid: text('user_did').notNull().references(() => users.privyDid, { onDelete: 'cascade' }),
  // Ensure a user can only have one strategy entry per safe type
  destinationSafeType: text('destination_safe_type', { enum: ['primary', 'tax', 'liquidity', 'yield'] }).notNull(), 
  // Percentage stored as integer (e.g., 30 for 30%)
  percentage: integer('percentage').notNull(), 
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull().$onUpdate(() => new Date()),
}, (table) => {
  return {
    userTypeUniqueIdx: uniqueIndex('user_strategy_type_unique_idx').on(table.userDid, table.destinationSafeType),
  };
});

// --- OFFRAMP RELATED TABLES ---

// OfframpTransfers table - Storing details about offramp transactions
export const offrampTransfers = pgTable('offramp_transfers', {
  id: uuid('id').primaryKey().defaultRandom(), // Internal unique ID
  userId: text('user_id').notNull().references(() => users.privyDid, { onDelete: 'cascade' }), // Link to user
  alignTransferId: text('align_transfer_id').notNull().unique(), // ID from Align API
  status: text('status', { 
      enum: ['pending', 'processing', 'completed', 'failed', 'canceled'] 
  }).notNull(), // Mirror Align statuses
  
  // Transfer Details
  amountToSend: text('amount_to_send').notNull(), // Amount of fiat to receive
  destinationCurrency: text('destination_currency').notNull(),
  destinationPaymentRails: text('destination_payment_rails'),
  // Store reference to the saved bank account used, if applicable
  destinationBankAccountId: uuid('destination_bank_account_id').references(() => userDestinationBankAccounts.id, { onDelete: 'set null' }), 
  // Store details of the bank account used (in case saved one is deleted, or for manual entry)
  destinationBankAccountSnapshot: jsonb('destination_bank_account_snapshot'), 

  // Crypto Deposit Details (from Align quote)
  depositAmount: text('deposit_amount').notNull(), // Amount of crypto to send
  depositToken: text('deposit_token').notNull(),
  depositNetwork: text('deposit_network').notNull(),
  depositAddress: text('deposit_address').notNull(),
  feeAmount: text('fee_amount'),
  quoteExpiresAt: timestamp('quote_expires_at'),

  // Crypto Transaction Details (User Execution)
  transactionHash: text('transaction_hash'), // Hash of the user's deposit tx
  userOpHash: text('user_op_hash'), // Hash if sent via AA/Relayer

  // Timestamps
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull().$onUpdate(() => new Date()),
}, (table) => {
  return {
    userIdx: index('offramp_transfers_user_id_idx').on(table.userId),
    alignIdIdx: index('offramp_transfers_align_id_idx').on(table.alignTransferId),
  };
});

// --- RELATIONS ---

// Define relations for bank tables
export const usersRelations = relations(users, ({ many }) => ({
  safes: many(userSafes),
  fundingSources: many(userFundingSources),
  destinationBankAccounts: many(userDestinationBankAccounts), // Added relation
  offrampTransfers: many(offrampTransfers), // Added relation
  allocationStrategies: many(allocationStrategies), // Added relation for strategies
}));

export const userSafesRelations = relations(userSafes, ({ one, many }) => ({
  user: one(users, {
    fields: [userSafes.userDid],
    references: [users.privyDid],
  }),
  allocationState: one(allocationStates, {
    fields: [userSafes.id],
    references: [allocationStates.userSafeId],
  }),
  // Add relation from UserSafes to UserFundingSources if needed
  // Example: user funding sources associated with this safe (might need linking table or direct relation)
}));

export const allocationStatesRelations = relations(allocationStates, ({ one }) => ({
  userSafe: one(userSafes, {
    fields: [allocationStates.userSafeId],
    references: [userSafes.id],
  }),
}));

export const userFundingSourcesRelations = relations(userFundingSources, ({ one }) => ({
  user: one(users, {
    fields: [userFundingSources.userPrivyDid],
    references: [users.privyDid],
  }),
}));

// Added relations for userDestinationBankAccounts
export const userDestinationBankAccountsRelations = relations(userDestinationBankAccounts, ({ one }) => ({
  user: one(users, {
    fields: [userDestinationBankAccounts.userId],
    references: [users.privyDid],
  }),
}));

// Added relations for offrampTransfers
export const offrampTransfersRelations = relations(offrampTransfers, ({ one }) => ({
  user: one(users, {
    fields: [offrampTransfers.userId],
    references: [users.privyDid],
  }),
  // Optional: Link back to the specific destination bank account used
  destinationBankAccount: one(userDestinationBankAccounts, {
      fields: [offrampTransfers.destinationBankAccountId],
      references: [userDestinationBankAccounts.id]
  })
}));

// Added relations for allocationStrategies
export const allocationStrategiesRelations = relations(allocationStrategies, ({ one }) => ({
  user: one(users, {
    fields: [allocationStrategies.userDid],
    references: [users.privyDid],
  }),
}));

// --- TYPE INFERENCE ---

// Type inference for bank tables
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;

export type UserSafe = typeof userSafes.$inferSelect;
export type NewUserSafe = typeof userSafes.$inferInsert;

export type AllocationState = typeof allocationStates.$inferSelect;
export type NewAllocationState = typeof allocationStates.$inferInsert;

export type UserFundingSource = typeof userFundingSources.$inferSelect;
export type NewUserFundingSource = typeof userFundingSources.$inferInsert;

// Added type inference for destination bank accounts
export type UserDestinationBankAccount = typeof userDestinationBankAccounts.$inferSelect;
export type NewUserDestinationBankAccount = typeof userDestinationBankAccounts.$inferInsert;

// Added type inference for offramp transfers
export type OfframpTransfer = typeof offrampTransfers.$inferSelect;
export type NewOfframpTransfer = typeof offrampTransfers.$inferInsert;

// Added type inference for allocation strategies
export type AllocationStrategy = typeof allocationStrategies.$inferSelect;
export type NewAllocationStrategy = typeof allocationStrategies.$inferInsert;

export const earnDeposits = pgTable(
  'earn_deposits',
  {
    id: varchar('id', { length: 255 }).primaryKey().$defaultFn(() => crypto.randomUUID()),
    userDid: text('user_did')
      .notNull()
      .references(() => users.privyDid, { onDelete: 'cascade' }),
    safeAddress: varchar('safe_address', { length: 42 }).notNull(),
    vaultAddress: varchar('vault_address', { length: 42 }).notNull(),
    tokenAddress: varchar('token_address', { length: 42 }).notNull(),
    assetsDeposited: bigint('assets_deposited', { mode: 'bigint' }).notNull(),
    sharesReceived: bigint('shares_received', { mode: 'bigint' }).notNull(),
    txHash: varchar('tx_hash', { length: 66 }).notNull().unique(),
    timestamp: timestamp('timestamp', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => {
    return {
      safeAddressIdx: index('earn_safe_address_idx').on(table.safeAddress),
      vaultAddressIdx: index('earn_vault_address_idx').on(table.vaultAddress),
      userDidIdx: index('earn_user_did_idx').on(table.userDid),
    };
  },
);


// Define relations if necessary, e.g., if you want to link earnDeposits back to userSafes or users directly in queries
// export const earnDepositsRelations = relations(earnDeposits, ({ one }) => ({
//   user: one(users, {
//     fields: [earnDeposits.userDid],
//     references: [users.privyDid],
//   }),
//   safe: one(userSafes, { // This relation might be complex if safeAddress is not unique across users in userSafes
//     fields: [earnDeposits.safeAddress, earnDeposits.userDid], // Example composite key
//     references: [userSafes.safeAddress, userSafes.userDid], // Example composite key
//   }),
// }));
