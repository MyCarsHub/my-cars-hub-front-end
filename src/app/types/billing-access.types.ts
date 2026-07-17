export type AccessStatusCode =
  | 'TRIAL_ACTIVE'
  | 'TRIAL_EXPIRED'
  | 'ACTIVE'
  | 'PAST_DUE'
  | 'BLOCKED'
  | 'NO_SUBSCRIPTION';

export type BlockReason =
  | 'TRIAL_EXPIRED'
  | 'PAYMENT_FAILED'
  | 'PAST_DUE'
  | 'CANCELED'
  | 'NO_SUBSCRIPTION';

export interface AccessStatusPlan {
  id: string;
  code: string;
  name: string;
  priceMonthly: number;
  maxVehicles: number | null;
  maxDrivers: number | null;
}

export interface AccessStatus {
  status: AccessStatusCode;
  trialEndsAt: string | null;
  graceEndsAt: string | null;
  plan: AccessStatusPlan | null;
  blocked: boolean;
  reason: BlockReason | null;
}
