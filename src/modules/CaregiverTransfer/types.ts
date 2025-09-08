export interface TeiMinimal {
  trackedEntityInstance: string;
  orgUnit?: string;
  attributes?: Array<{ attribute: string; value: any; displayName?: string }>;
  enrollments?: Array<{ enrollment: string; program: string; orgUnit: string; status: string }>;
  relationships?: Array<any>;
}

export interface ChildSelection {
  childTei: string;
  name?: string;            // <-- NEW: nice display name
  selected: boolean;
  existingRelId?: string;   // existing guardian-of rel ID
}

export type TransferDirection = "caregiver_to_child" | "child_to_caregiver";

export interface TransferPlan {
  oldCaregiver: TeiMinimal;
  newCaregiver: TeiMinimal;
  children: ChildSelection[];
  expectedDirection: TransferDirection;
}
