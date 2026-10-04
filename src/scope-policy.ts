export class ScopeRefusal extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScopeRefusal";
  }
}

export class ScopeUserError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScopeUserError";
  }
}

export type RateUnit = "hour" | "day" | "fixed";

export type EngagementStatus = "draft" | "approved";

export const REFUSED_DISCOUNT =
  "Refused: lowering an approved rate is a discount. File a discount change order and approve that order. save_rate will not lower an approved rate.";

export const REFUSED_RATE_UNIT =
  "Refused: the approved rate unit stays as it was approved. save_rate will not change it.";

export const REFUSED_NEW_RATE =
  "Refused: a new rate after approval is not in the approved record. File an add_rate change order and approve it.";

export const REFUSED_NEW_WORK =
  "Refused: that work is not in the approved scope. File an add_work change order and approve it before adding it.";

export const REFUSED_RENAME =
  "Refused: renaming approved work would change the scope. File a change order instead.";

export const RECORD_GUIDANCE =
  "Answer only from this record. Draft status means the terms are not an approved commitment. Proposed change orders are not authorization. Do not invent a discount or promise work that is not an approved scope item or an applied change order. save_rate and save_scope_item refuse a lower rate and new work after approval.";

export function assertRateWrite(input: {
  status: EngagementStatus;
  existingUnit: RateUnit | undefined;
  existingAmount: number | undefined;
  nextUnit: RateUnit;
  nextAmount: number;
}): void {
  if (input.existingAmount === undefined || input.existingUnit === undefined) {
    if (input.status === "approved") throw new ScopeRefusal(REFUSED_NEW_RATE);
    return;
  }
  if (input.status !== "approved") return;
  if (input.existingUnit !== input.nextUnit) throw new ScopeRefusal(REFUSED_RATE_UNIT);
  if (input.nextAmount < input.existingAmount) throw new ScopeRefusal(REFUSED_DISCOUNT);
}

export function assertNewScopeItem(status: EngagementStatus): void {
  if (status === "approved") throw new ScopeRefusal(REFUSED_NEW_WORK);
}

export function assertScopeTitle(status: EngagementStatus, currentTitle: string, nextTitle: string): void {
  if (status === "approved" && currentTitle !== nextTitle) throw new ScopeRefusal(REFUSED_RENAME);
}
