import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { REFUSED_DISCOUNT, REFUSED_NEW_RATE, REFUSED_NEW_WORK, REFUSED_RENAME } from "../src/scope-policy.js";
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
});
