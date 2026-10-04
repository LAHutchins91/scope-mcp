import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  RECORD_GUIDANCE,
  ScopeRefusal,
  ScopeUserError,
  assertNewScopeItem,
  assertRateWrite,
  assertScopeTitle,
  type EngagementStatus,
  type RateUnit
} from "./scope-policy.js";

export type { EngagementStatus, RateUnit };

const MAX_ENGAGEMENTS = 50;
const MAX_ITEMS = 200;
const MAX_RATES = 100;
const MAX_CHANGE_ORDERS = 200;
const MAX_SUPPORT = 200;

export type ScopeItem = {
  id: string;
  title: string;
  description: string;
  createdAt: string;
  updatedAt: string;
};

export type Rate = {
  id: string;
  code: string;
  label: string;
  amountMinor: number;
  unit: RateUnit;
  createdAt: string;
  updatedAt: string;
};

export type Deadline = {
  id: string;
  scopeItemId: string;
  dueOn: string;
  updatedAt: string;
};

export type ChangeKind = "add_work" | "discount_rate" | "add_rate" | "move_deadline";

export type ChangeOrder = {
  id: string;
  kind: ChangeKind;
  status: "proposed" | "approved";
  summary: string;
  workTitle: string | null;
  workDescription: string | null;
  rateCode: string | null;
  rateLabel: string | null;
  amountMinor: number | null;
  unit: RateUnit | null;
  scopeItemId: string | null;
  dueOn: string | null;
  applied: boolean;
  createdAt: string;
  approvedAt: string | null;
};

export type Engagement = {
  id: string;
  clientName: string;
  title: string;
  summary: string;
  currency: string;
  status: EngagementStatus;
  approvedAt: string | null;
  items: ScopeItem[];
  rates: Rate[];
  deadlines: Deadline[];
  changeOrders: ChangeOrder[];
  createdAt: string;
  updatedAt: string;
};

export type EngagementSummary = {
  id: string;
  clientName: string;
  title: string;
  status: EngagementStatus;
  currency: string;
  itemCount: number;
  rateCount: number;
};

export type Profile = {
  userId: string;
  subscriptionStatus: string;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
};

export type ApprovedRecord = {
  engagement: {
    id: string;
    clientName: string;
    title: string;
    summary: string;
    currency: string;
    status: EngagementStatus;
    approvedAt: string | null;
  };
  scopeItems: ScopeItem[];
  rates: Rate[];
  deadlines: Deadline[];
  approvedChangeOrders: ChangeOrder[];
  proposedChangeOrders: ChangeOrder[];
  guidance: string;
};

export type CreateEngagementInput = {
  clientName: string;
  title: string;
  summary?: string;
  currency: string;
};

export type SaveScopeItemInput = {
  engagementId: string;
  scopeItemId?: string;
  title: string;
  description: string;
};

export type SaveRateInput = {
  engagementId: string;
  code: string;
  label: string;
  amountMinor: number;
  unit: RateUnit;
};

export type SaveDeadlineInput = {
  engagementId: string;
  scopeItemId: string;
  dueOn: string;
};

export type FileChangeOrderInput = {
  engagementId: string;
  kind: ChangeKind;
  summary: string;
  workTitle?: string;
  workDescription?: string;
  rateCode?: string;
  rateLabel?: string;
  amountMinor?: number;
  unit?: RateUnit;
  scopeItemId?: string;
  dueOn?: string;
};

type SupportRequest = { id: string; email: string; message: string; createdAt: string };

type FileData = {
  version: 1;
  profiles: Record<string, Profile>;
  engagements: Record<string, Engagement[]>;
  supportRequests: SupportRequest[];
};

export type ScopeStore = {
  getProfile(userId: string): Promise<Profile>;
  updateProfile(userId: string, patch: Partial<Omit<Profile, "userId">>): Promise<Profile>;
  listEngagements(userId: string, offset: number): Promise<{ engagements: EngagementSummary[]; nextOffset: number | null }>;
  createEngagement(userId: string, input: CreateEngagementInput): Promise<Engagement>;
  getRecord(userId: string, engagementId: string): Promise<ApprovedRecord>;
  saveScopeItem(userId: string, input: SaveScopeItemInput): Promise<ScopeItem>;
  saveRate(userId: string, input: SaveRateInput): Promise<Rate>;
  saveDeadline(userId: string, input: SaveDeadlineInput): Promise<Deadline>;
  approveScope(userId: string, engagementId: string): Promise<ApprovedRecord>;
  fileChangeOrder(userId: string, input: FileChangeOrderInput): Promise<ChangeOrder>;
  approveChangeOrder(userId: string, engagementId: string, changeOrderId: string): Promise<ApprovedRecord>;
  addSupportRequest(input: { email: string; message: string }): Promise<{ id: string }>;
};

export function defaultScopeDataPath(): string {
  return path.join(os.homedir(), ".scope", "scope.json");
}

function emptyData(): FileData {
  return { version: 1, profiles: {}, engagements: {}, supportRequests: [] };
}

function nowIso(): string {
  return new Date().toISOString();
}

function cleanText(value: string, label: string, max: number): string {
  const text = value.trim();
  if (!text || text.length > max) throw new ScopeUserError(`${label} must be 1–${max} characters.`);
  return text;
}

function cleanCurrency(value: string): string {
  if (!/^[A-Z]{3}$/.test(value)) throw new ScopeUserError("Currency must be a three-letter code.");
  return value;
}

function cleanCode(value: string): string {
  const code = value.trim();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(code) || code.length > 40) {
    throw new ScopeUserError("Rate code must be a short lowercase slug.");
  }
  return code;
}

function assertAmount(amount: number): number {
  if (!Number.isInteger(amount) || amount < 1 || amount > 1_000_000_000_000) {
    throw new ScopeUserError("Amount must be a positive integer in minor currency units.");
  }
  return amount;
}

function assertUnit(unit: string): RateUnit {
  if (unit !== "hour" && unit !== "day" && unit !== "fixed") throw new ScopeUserError("Rate unit must be hour, day, or fixed.");
  return unit;
}

function assertDate(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new ScopeUserError("Deadline must be a calendar date.");
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) {
    throw new ScopeUserError("Deadline must be a calendar date.");
  }
  return value;
}

function blankProfile(userId: string): Profile {
  return {
    userId,
    subscriptionStatus: "none",
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false
  };
}

function summary(engagement: Engagement): EngagementSummary {
  return {
    id: engagement.id,
    clientName: engagement.clientName,
    title: engagement.title,
    status: engagement.status,
    currency: engagement.currency,
    itemCount: engagement.items.length,
    rateCount: engagement.rates.length
  };
}

function toRecord(engagement: Engagement): ApprovedRecord {
  return {
    engagement: {
      id: engagement.id,
      clientName: engagement.clientName,
      title: engagement.title,
      summary: engagement.summary,
      currency: engagement.currency,
      status: engagement.status,
      approvedAt: engagement.approvedAt
    },
    scopeItems: engagement.items,
    rates: engagement.rates,
    deadlines: engagement.deadlines,
    approvedChangeOrders: engagement.changeOrders.filter((order) => order.status === "approved"),
    proposedChangeOrders: engagement.changeOrders.filter((order) => order.status === "proposed"),
    guidance: RECORD_GUIDANCE
  };
}

function engagementsFor(data: FileData, userId: string): Engagement[] {
  const rows = data.engagements[userId];
  if (!rows) {
    data.engagements[userId] = [];
    return data.engagements[userId];
  }
  return rows;
}

function findEngagement(data: FileData, userId: string, engagementId: string): Engagement {
  const engagement = (data.engagements[userId] ?? []).find((row) => row.id === engagementId);
  if (!engagement) throw new ScopeUserError("Engagement not found");
  return engagement;
}

function findItem(engagement: Engagement, scopeItemId: string): ScopeItem {
  const item = engagement.items.find((row) => row.id === scopeItemId);
  if (!item) throw new ScopeUserError("Scope item not found");
  return item;
}

export function createFileScopeStore(filePath: string): ScopeStore {
  let chain: Promise<void> = Promise.resolve();

  async function read(): Promise<FileData> {
    try {
      const text = await readFile(filePath, "utf8");
      if (!text.trim()) return emptyData();
      const parsed = JSON.parse(text) as FileData;
      if (parsed.version !== 1 || !parsed.profiles || !parsed.engagements || !Array.isArray(parsed.supportRequests)) {
        throw new ScopeUserError("Scope data could not be read.");
      }
      return parsed;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyData();
      if (error instanceof ScopeUserError) throw error;
      throw new ScopeUserError("Scope data could not be read.");
    }
  }

  async function write(data: FileData): Promise<void> {
    await mkdir(path.dirname(filePath), { recursive: true });
    const tmp = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${process.pid}.${randomUUID()}.tmp`);
    await writeFile(tmp, JSON.stringify(data), "utf8");
    await rename(tmp, filePath);
  }

  function enqueue<T>(fn: (data: FileData) => T, persist: boolean): Promise<T> {
    const run = chain.then(async () => {
      const data = await read();
      const result = fn(data);
      if (persist) await write(data);
      return structuredClone(result);
    });
    chain = run.then(() => undefined, () => undefined);
    return run;
  }

  return {
    getProfile(userId) {
      return enqueue((data) => data.profiles[userId] ?? blankProfile(userId), false);
    },
    updateProfile(userId, patch) {
      return enqueue((data) => {
        const current = data.profiles[userId] ?? blankProfile(userId);
        const next: Profile = { ...current, ...patch, userId };
        data.profiles[userId] = next;
        return next;
      }, true);
    },
    listEngagements(userId, offset) {
      return enqueue((data) => {
        const rows = data.engagements[userId] ?? [];
        const start = Math.max(0, offset);
        const page = rows.slice(start, start + MAX_ENGAGEMENTS).map(summary);
        const nextOffset = start + page.length < rows.length ? start + page.length : null;
        return { engagements: page, nextOffset };
      }, false);
    },
    createEngagement(userId, input) {
      return enqueue((data) => {
        const rows = engagementsFor(data, userId);
        if (rows.length >= MAX_ENGAGEMENTS) throw new ScopeUserError("Engagement limit reached.");
        const stamp = nowIso();
        const engagement: Engagement = {
          id: randomUUID(),
          clientName: cleanText(input.clientName, "Client name", 200),
          title: cleanText(input.title, "Title", 200),
          summary: input.summary?.trim() ? cleanText(input.summary, "Summary", 4000) : "",
          currency: cleanCurrency(input.currency),
          status: "draft",
          approvedAt: null,
          items: [],
          rates: [],
          deadlines: [],
          changeOrders: [],
          createdAt: stamp,
          updatedAt: stamp
        };
        rows.unshift(engagement);
        return engagement;
      }, true);
    },
    getRecord(userId, engagementId) {
      return enqueue((data) => toRecord(findEngagement(data, userId, engagementId)), false);
    },
    saveScopeItem(userId, input) {
      return enqueue((data) => {
        const engagement = findEngagement(data, userId, input.engagementId);
        const title = cleanText(input.title, "Title", 200);
        const description = cleanText(input.description, "Description", 12000);
        const stamp = nowIso();
        if (input.scopeItemId) {
          const item = findItem(engagement, input.scopeItemId);
          assertScopeTitle(engagement.status, item.title, title);
          if (engagement.items.some((row) => row.id !== item.id && row.title === title)) {
            throw new ScopeUserError("A scope item with that title already exists.");
          }
          item.title = title;
          item.description = description;
          item.updatedAt = stamp;
          engagement.updatedAt = stamp;
          return item;
        }
        assertNewScopeItem(engagement.status);
        if (engagement.items.length >= MAX_ITEMS) throw new ScopeUserError("Scope item limit reached.");
        if (engagement.items.some((row) => row.title === title)) {
          throw new ScopeUserError("A scope item with that title already exists.");
        }
        const item: ScopeItem = { id: randomUUID(), title, description, createdAt: stamp, updatedAt: stamp };
        engagement.items.push(item);
        engagement.updatedAt = stamp;
        return item;
      }, true);
    },
    saveRate(userId, input) {
      return enqueue((data) => {
        const engagement = findEngagement(data, userId, input.engagementId);
        const code = cleanCode(input.code);
        const label = cleanText(input.label, "Label", 200);
        const amountMinor = assertAmount(input.amountMinor);
        const unit = assertUnit(input.unit);
        const existing = engagement.rates.find((row) => row.code === code);
        assertRateWrite({
          status: engagement.status,
          existingUnit: existing?.unit,
          existingAmount: existing?.amountMinor,
          nextUnit: unit,
          nextAmount: amountMinor
        });
        const stamp = nowIso();
        if (existing) {
          existing.label = label;
          existing.amountMinor = amountMinor;
          existing.unit = unit;
          existing.updatedAt = stamp;
          engagement.updatedAt = stamp;
          return existing;
        }
        if (engagement.rates.length >= MAX_RATES) throw new ScopeUserError("Rate limit reached.");
        const rate: Rate = { id: randomUUID(), code, label, amountMinor, unit, createdAt: stamp, updatedAt: stamp };
        engagement.rates.push(rate);
        engagement.updatedAt = stamp;
        return rate;
      }, true);
    },
    saveDeadline(userId, input) {
      return enqueue((data) => {
        const engagement = findEngagement(data, userId, input.engagementId);
        findItem(engagement, input.scopeItemId);
        const dueOn = assertDate(input.dueOn);
        const stamp = nowIso();
        const existing = engagement.deadlines.find((row) => row.scopeItemId === input.scopeItemId);
        if (existing) {
          existing.dueOn = dueOn;
          existing.updatedAt = stamp;
          engagement.updatedAt = stamp;
          return existing;
        }
        const deadline: Deadline = { id: randomUUID(), scopeItemId: input.scopeItemId, dueOn, updatedAt: stamp };
        engagement.deadlines.push(deadline);
        engagement.updatedAt = stamp;
        return deadline;
      }, true);
    },
    approveScope(userId, engagementId) {
      return enqueue((data) => {
        const engagement = findEngagement(data, userId, engagementId);
        if (engagement.status === "approved") return toRecord(engagement);
        if (engagement.items.length === 0) throw new ScopeUserError("A scope item is required before the scope can be approved.");
        const stamp = nowIso();
        engagement.status = "approved";
        engagement.approvedAt = stamp;
        engagement.updatedAt = stamp;
        return toRecord(engagement);
      }, true);
    },
    fileChangeOrder(userId, input) {
      return enqueue((data) => {
        const engagement = findEngagement(data, userId, input.engagementId);
        if (engagement.status !== "approved") {
          throw new ScopeUserError("Approve the scope before filing a change order.");
        }
        if (engagement.changeOrders.length >= MAX_CHANGE_ORDERS) throw new ScopeUserError("Change order limit reached.");
        const summary = cleanText(input.summary, "Summary", 1000);
        const order: ChangeOrder = {
          id: randomUUID(),
          kind: input.kind,
          status: "proposed",
          summary,
          workTitle: null,
          workDescription: null,
          rateCode: null,
          rateLabel: null,
          amountMinor: null,
          unit: null,
          scopeItemId: null,
          dueOn: null,
          applied: false,
          createdAt: nowIso(),
          approvedAt: null
        };
        if (input.kind === "add_work") {
          order.workTitle = cleanText(input.workTitle ?? "", "Work title", 200);
          order.workDescription = cleanText(input.workDescription ?? "", "Work description", 12000);
          if (engagement.items.some((item) => item.title === order.workTitle)) {
            throw new ScopeUserError("That work is already in the approved scope.");
          }
        } else if (input.kind === "discount_rate") {
          order.rateCode = cleanCode(input.rateCode ?? "");
          order.amountMinor = assertAmount(input.amountMinor ?? Number.NaN);
          const rate = engagement.rates.find((row) => row.code === order.rateCode);
          if (!rate) throw new ScopeUserError("Rate not found");
          if (order.amountMinor >= rate.amountMinor) {
            throw new ScopeUserError("That change order does not lower the approved rate.");
          }
        } else if (input.kind === "add_rate") {
          order.rateCode = cleanCode(input.rateCode ?? "");
          order.rateLabel = cleanText(input.rateLabel ?? "", "Label", 200);
          order.amountMinor = assertAmount(input.amountMinor ?? Number.NaN);
          order.unit = assertUnit(input.unit ?? "");
          if (engagement.rates.some((row) => row.code === order.rateCode)) {
            throw new ScopeUserError("A rate with that code already exists.");
          }
        } else if (input.kind === "move_deadline") {
          if (!input.scopeItemId) throw new ScopeUserError("Scope item not found");
          findItem(engagement, input.scopeItemId);
          order.scopeItemId = input.scopeItemId;
          order.dueOn = assertDate(input.dueOn ?? "");
        } else {
          throw new ScopeUserError("Unknown change order kind.");
        }
        engagement.changeOrders.unshift(order);
        engagement.updatedAt = order.createdAt;
        return order;
      }, true);
    },
    approveChangeOrder(userId, engagementId, changeOrderId) {
      return enqueue((data) => {
        const engagement = findEngagement(data, userId, engagementId);
        const order = engagement.changeOrders.find((row) => row.id === changeOrderId);
        if (!order) throw new ScopeUserError("Change order not found");
        if (order.applied) return toRecord(engagement);
        if (engagement.status !== "approved") throw new ScopeUserError("Approve the scope before filing a change order.");
        const stamp = nowIso();
        if (order.kind === "add_work") {
          if (!order.workTitle || !order.workDescription) throw new ScopeUserError("That work is already in the approved scope.");
          if (engagement.items.some((item) => item.title === order.workTitle)) {
            throw new ScopeUserError("That work is already in the approved scope.");
          }
          if (engagement.items.length >= MAX_ITEMS) throw new ScopeUserError("Scope item limit reached.");
          engagement.items.push({
            id: randomUUID(),
            title: order.workTitle,
            description: order.workDescription,
            createdAt: stamp,
            updatedAt: stamp
          });
        } else if (order.kind === "discount_rate") {
          const rate = engagement.rates.find((row) => row.code === order.rateCode);
          if (!rate || order.amountMinor === null) throw new ScopeUserError("Rate not found");
          if (order.amountMinor >= rate.amountMinor) {
            throw new ScopeUserError("That change order does not lower the approved rate.");
          }
          rate.amountMinor = order.amountMinor;
          rate.updatedAt = stamp;
        } else if (order.kind === "add_rate") {
          if (!order.rateCode || !order.rateLabel || order.amountMinor === null || !order.unit) {
            throw new ScopeUserError("Rate not found");
          }
          if (engagement.rates.some((row) => row.code === order.rateCode)) {
            throw new ScopeUserError("A rate with that code already exists.");
          }
          if (engagement.rates.length >= MAX_RATES) throw new ScopeUserError("Rate limit reached.");
          engagement.rates.push({
            id: randomUUID(),
            code: order.rateCode,
            label: order.rateLabel,
            amountMinor: order.amountMinor,
            unit: order.unit,
            createdAt: stamp,
            updatedAt: stamp
          });
        } else if (order.kind === "move_deadline") {
          if (!order.scopeItemId || !order.dueOn) throw new ScopeUserError("Scope item not found");
          findItem(engagement, order.scopeItemId);
          const existing = engagement.deadlines.find((row) => row.scopeItemId === order.scopeItemId);
          if (existing) {
            existing.dueOn = order.dueOn;
            existing.updatedAt = stamp;
          } else {
            engagement.deadlines.push({
              id: randomUUID(),
              scopeItemId: order.scopeItemId,
              dueOn: order.dueOn,
              updatedAt: stamp
            });
          }
        }
        order.status = "approved";
        order.applied = true;
        order.approvedAt = stamp;
        engagement.updatedAt = stamp;
        return toRecord(engagement);
      }, true);
    },
    addSupportRequest(input) {
      return enqueue((data) => {
        const request: SupportRequest = {
          id: randomUUID(),
          email: input.email,
          message: input.message,
          createdAt: nowIso()
        };
        data.supportRequests.push(request);
        if (data.supportRequests.length > MAX_SUPPORT) data.supportRequests.splice(0, data.supportRequests.length - MAX_SUPPORT);
        return { id: request.id };
      }, true);
    }
  };
}

export function isScopeRefusal(error: unknown): error is ScopeRefusal {
  return error instanceof ScopeRefusal;
}
