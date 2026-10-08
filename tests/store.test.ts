import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  INVALID_CHANGE_KIND,
  INVALID_CURRENCY,
  INVALID_RATE_CODE,
  INVALID_RATE_UNIT,
  REFUSED_DISCOUNT,
  REFUSED_NEW_RATE,
  REFUSED_NEW_WORK,
  REFUSED_RENAME
} from "../src/scope-policy.js";
import { createFileScopeStore } from "../src/scope-store.js";

async function store() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "scope-"));
  return createFileScopeStore(path.join(dir, "scope.json"));
}

describe("scope store", () => {
  it("refuses a discount and unapproved work after the scope is approved", async () => {
    const saved = await store();
    const engagement = await saved.createEngagement("user-1", {
      clientName: "Northwind",
      title: "Site rebuild",
      currency: "EUR"
    });
    const item = await saved.saveScopeItem("user-1", {
      engagementId: engagement.id,
      title: "Homepage",
      description: "One responsive homepage."
    });
    await saved.saveRate("user-1", {
      engagementId: engagement.id,
      code: "build-day",
      label: "Build day",
      amountMinor: 5000,
      unit: "day"
    });
    await saved.saveRate("user-1", {
      engagementId: engagement.id,
      code: "build-day",
      label: "Build day",
      amountMinor: 4000,
      unit: "day"
    });
    await saved.saveDeadline("user-1", { engagementId: engagement.id, scopeItemId: item.id, dueOn: "2026-11-02" });
    await saved.approveScope("user-1", engagement.id);

    await expect(saved.saveRate("user-1", {
      engagementId: engagement.id,
      code: "build-day",
      label: "Build day",
      amountMinor: 3000,
      unit: "day"
    })).rejects.toThrow(REFUSED_DISCOUNT);

    await expect(saved.saveScopeItem("user-1", {
      engagementId: engagement.id,
      title: "Extra landing page",
      description: "A page that was never approved."
    })).rejects.toThrow(REFUSED_NEW_WORK);

    await expect(saved.saveScopeItem("user-1", {
      engagementId: engagement.id,
      scopeItemId: item.id,
      title: "Homepage plus a shop",
      description: "Expanded without a change order."
    })).rejects.toThrow(REFUSED_RENAME);

    await expect(saved.saveRate("user-1", {
      engagementId: engagement.id,
      code: "secret-discount",
      label: "Quiet rate",
      amountMinor: 100,
      unit: "hour"
    })).rejects.toThrow(REFUSED_NEW_RATE);

    await expect(saved.saveRate("user-1", {
      engagementId: engagement.id,
      code: "build-day",
      label: "Build day",
      amountMinor: 4500,
      unit: "hour"
    })).rejects.toThrow("Refused: the approved rate unit stays as it was approved.");

    const updated = await saved.saveScopeItem("user-1", {
      engagementId: engagement.id,
      scopeItemId: item.id,
      title: "Homepage",
      description: "One responsive homepage, with the approved contact form."
    });
    expect(updated.description).toContain("contact form");

    const raised = await saved.saveRate("user-1", {
      engagementId: engagement.id,
      code: "build-day",
      label: "Build day",
      amountMinor: 4500,
      unit: "day"
    });
    expect(raised.amountMinor).toBe(4500);

    const proposed = await saved.fileChangeOrder("user-1", {
      engagementId: engagement.id,
      kind: "discount_rate",
      summary: "Agreed reduction for the delayed start.",
      rateCode: "build-day",
      amountMinor: 4200
    });
    expect(proposed.status).toBe("proposed");
    expect(proposed.applied).toBe(false);
    const before = await saved.getRecord("user-1", engagement.id);
    expect(before.rates[0]?.amountMinor).toBe(4500);
    expect(before.proposedChangeOrders).toHaveLength(1);
    expect(before.approvedChangeOrders).toHaveLength(0);

    const discounted = await saved.approveChangeOrder("user-1", engagement.id, proposed.id);
    expect(discounted.rates.find((rate) => rate.code === "build-day")?.amountMinor).toBe(4200);
    expect(discounted.approvedChangeOrders[0]?.applied).toBe(true);

    const added = await saved.fileChangeOrder("user-1", {
      engagementId: engagement.id,
      kind: "add_work",
      summary: "Add the about page the client asked for.",
      workTitle: "About page",
      workDescription: "A single about page."
    });
    const withWork = await saved.approveChangeOrder("user-1", engagement.id, added.id);
    expect(withWork.scopeItems.map((row) => row.title)).toContain("About page");
    const again = await saved.approveChangeOrder("user-1", engagement.id, added.id);
    expect(again.scopeItems.filter((row) => row.title === "About page")).toHaveLength(1);

    await saved.saveDeadline("user-1", { engagementId: engagement.id, scopeItemId: item.id, dueOn: "2026-12-01" });
    const record = await saved.getRecord("user-1", engagement.id);
    expect(record.deadlines[0]?.dueOn).toBe("2026-12-01");
    expect(record.guidance).toContain("Do not invent a discount");
  });

  it("keeps each freelancer's record and reloads it from disk", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "scope-"));
    const file = path.join(dir, "scope.json");
    const first = createFileScopeStore(file);
    const engagement = await first.createEngagement("user-1", { clientName: "Ada", title: "Audit", currency: "GBP" });
    await expect(first.getRecord("user-2", engagement.id)).rejects.toThrow("Engagement not found");
    const second = createFileScopeStore(file);
    const listed = await second.listEngagements("user-1", 0);
    expect(listed.engagements[0]?.id).toBe(engagement.id);
    expect(await second.listEngagements("user-2", 0)).toEqual({ engagements: [], nextOffset: null });
  });

  it("normalizes rate codes and finds a rate saved in another case", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "scope-"));
    const file = path.join(dir, "scope.json");
    const saved = createFileScopeStore(file);
    const engagement = await saved.createEngagement("user-1", {
      clientName: "Harbor Dental",
      title: "Website redesign",
      currency: " gbp "
    });
    expect(engagement.currency).toBe("GBP");
    await saved.saveScopeItem("user-1", {
      engagementId: engagement.id,
      title: "Homepage",
      description: "One responsive homepage."
    });
    const upper = await saved.saveRate("user-1", {
      engagementId: engagement.id,
      code: "DAY",
      label: "Design and build day rate",
      amountMinor: 65000,
      unit: "DAY"
    });
    expect(upper.code).toBe("day");
    expect(upper.unit).toBe("day");

    const mixed = await saved.saveRate("user-1", {
      engagementId: engagement.id,
      code: "  Day  ",
      label: "Design and build day rate",
      amountMinor: 70000,
      unit: "Day"
    });
    expect(mixed.id).toBe(upper.id);
    expect(mixed.code).toBe("day");
    expect(mixed.amountMinor).toBe(70000);

    const hyphenated = await saved.saveRate("user-1", {
      engagementId: engagement.id,
      code: "Build-Day",
      label: "Build day",
      amountMinor: 80000,
      unit: "hour"
    });
    expect(hyphenated.code).toBe("build-day");
    const again = await saved.saveRate("user-1", {
      engagementId: engagement.id,
      code: "BUILD-DAY",
      label: "Build day",
      amountMinor: 81000,
      unit: "HOUR"
    });
    expect(again.id).toBe(hyphenated.id);
    expect(again.code).toBe("build-day");

    await expect(saved.saveRate("user-1", {
      engagementId: engagement.id,
      code: "DAY RATE",
      label: "Bad",
      amountMinor: 100,
      unit: "day"
    })).rejects.toThrow(INVALID_RATE_CODE);
    await expect(saved.saveRate("user-1", {
      engagementId: engagement.id,
      code: "week",
      label: "Week",
      amountMinor: 100,
      unit: "WEEK"
    })).rejects.toThrow(INVALID_RATE_UNIT);
    await expect(saved.createEngagement("user-1", {
      clientName: "Ada",
      title: "Audit",
      currency: "US1"
    })).rejects.toThrow(INVALID_CURRENCY);

    const raw = JSON.parse(await readFile(file, "utf8")) as {
      engagements: Record<string, Array<{ rates: Array<{ code: string }> }>>;
    };
    const stored = raw.engagements["user-1"]?.[0];
    expect(stored).toBeTruthy();
    const dayRate = stored?.rates.find((rate) => rate.code === "day");
    expect(dayRate).toBeTruthy();
    if (dayRate) dayRate.code = "DAY";
    await writeFile(file, JSON.stringify(raw));

    const reloaded = createFileScopeStore(file);
    await reloaded.approveScope("user-1", engagement.id);
    const proposed = await reloaded.fileChangeOrder("user-1", {
      engagementId: engagement.id,
      kind: "DISCOUNT_RATE",
      summary: "Client asked for a lower day rate.",
      rateCode: "day",
      amountMinor: 60000
    });
    expect(proposed.rateCode).toBe("day");
    expect(proposed.kind).toBe("discount_rate");
    const before = await reloaded.getRecord("user-1", engagement.id);
    expect(before.rates.filter((rate) => rate.code === "day")).toHaveLength(1);
    expect(before.rates.find((rate) => rate.code === "day")?.amountMinor).toBe(70000);

    const applied = await reloaded.approveChangeOrder("user-1", engagement.id, proposed.id);
    expect(applied.rates.find((rate) => rate.code === "day")?.amountMinor).toBe(60000);

    const added = await reloaded.fileChangeOrder("user-1", {
      engagementId: engagement.id,
      kind: "Add_Rate",
      summary: "Add a weekend rate.",
      rateCode: "Weekend",
      rateLabel: "Weekend",
      amountMinor: 90000,
      unit: "FIXED"
    });
    expect(added.rateCode).toBe("weekend");
    expect(added.unit).toBe("fixed");
    const withRate = await reloaded.approveChangeOrder("user-1", engagement.id, added.id);
    expect(withRate.rates.find((rate) => rate.code === "weekend")?.unit).toBe("fixed");

    await expect(reloaded.fileChangeOrder("user-1", {
      engagementId: engagement.id,
      kind: "nope",
      summary: "Not a real kind."
    })).rejects.toThrow(INVALID_CHANGE_KIND);
  });
});
