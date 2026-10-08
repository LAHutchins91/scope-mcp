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

export const RATE_UNITS = ["hour", "day", "fixed"] as const;

export type RateUnit = (typeof RATE_UNITS)[number];

export const CHANGE_KINDS = ["add_work", "discount_rate", "add_rate", "move_deadline"] as const;

export type ChangeKind = (typeof CHANGE_KINDS)[number];

export type EngagementStatus = "draft" | "approved";

export const INVALID_RATE_CODE =
  "Rate code must be a short lowercase slug. Allowed values: lowercase letters a-z, digits 0-9, and single hyphens between segments, at most 40 characters.";

export const INVALID_RATE_UNIT = `Rate unit must be ${RATE_UNITS.slice(0, -1).join(", ")}, or ${RATE_UNITS[RATE_UNITS.length - 1]}.`;

export const INVALID_CHANGE_KIND = `Change order kind must be ${CHANGE_KINDS.slice(0, -1).join(", ")}, or ${CHANGE_KINDS[CHANGE_KINDS.length - 1]}.`;

export const INVALID_CURRENCY = "Currency must be a three-letter code. Allowed values: three letters A-Z.";

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
