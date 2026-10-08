import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PRO_REQUIRED, SIGN_IN_REQUIRED } from "../src/access.js";
import { INVALID_CURRENCY, INVALID_RATE_CODE } from "../src/scope-policy.js";
import { createFileScopeStore, type ScopeStore } from "../src/scope-store.js";
import { SCOPE_TOOL_NAMES, createScopeMcpServer } from "../src/scope-tools.js";

async function connect(options: { userId: string; entitled: boolean; store: ScopeStore }) {
  const client = new Client({ name: "scope-test", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createScopeMcpServer(options);
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return client;
}

function textOf(result: unknown): string {
  const content = (result as { content?: Array<{ text?: string }> }).content;
  return content?.[0]?.text ?? "";
}

describe("scope tools", () => {
  it("lists the Scope tools", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "scope-"));
    const client = await connect({ userId: "", entitled: false, store: createFileScopeStore(path.join(dir, "scope.json")) });
    const listed = await client.listTools();
    expect(listed.tools.map((tool) => tool.name).sort()).toEqual([...SCOPE_TOOL_NAMES].sort());
    const blob = listed.tools.map((tool) => `${tool.name} ${tool.description ?? ""}`).join("\n");
    expect(blob).not.toMatch(/\$\d/);
    expect(blob.toLowerCase()).not.toContain("dollar");
  });

  it("refuses tool calls without sign-in or an active trial", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "scope-"));
    const saved = createFileScopeStore(path.join(dir, "scope.json"));
    const anonymous = await connect({ userId: "", entitled: false, store: saved });
    const signedOut = await anonymous.callTool({ name: "list_engagements", arguments: {} });
    expect(signedOut.isError).toBe(true);
    expect(textOf(signedOut)).toContain(SIGN_IN_REQUIRED);

    const unpaid = await connect({ userId: "user-1", entitled: false, store: saved });
    const blocked = await unpaid.callTool({ name: "list_engagements", arguments: {} });
    expect(blocked.isError).toBe(true);
    expect(textOf(blocked)).toContain(PRO_REQUIRED);
  });

  it("refuses a discount and extra work unless a change order is approved", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "scope-"));
    const saved = createFileScopeStore(path.join(dir, "scope.json"));
    const client = await connect({ userId: "user-1", entitled: true, store: saved });
    const created = await client.callTool({
      name: "create_engagement",
      arguments: { clientName: "Northwind", title: "Site rebuild", currency: "EUR" }
    });
    const engagementId = JSON.parse(textOf(created)).engagement.id as string;
    const item = await client.callTool({
      name: "save_scope_item",
      arguments: { engagementId, title: "Homepage", description: "One responsive homepage." }
    });
    const scopeItemId = JSON.parse(textOf(item)).id as string;
    await client.callTool({
      name: "save_rate",
      arguments: { engagementId, code: "build-day", label: "Build day", amountMinor: 8000, unit: "day" }
    });
    await client.callTool({
      name: "save_deadline",
      arguments: { engagementId, scopeItemId, dueOn: "2026-11-15" }
    });
    await client.callTool({ name: "approve_scope", arguments: { engagementId, confirmed: true } });

    const discount = await client.callTool({
      name: "save_rate",
      arguments: { engagementId, code: "build-day", label: "Build day", amountMinor: 1000, unit: "day" }
    });
    expect(discount.isError).toBe(true);
    expect(textOf(discount)).toContain("Refused:");

    const extra = await client.callTool({
      name: "save_scope_item",
      arguments: { engagementId, title: "Shop", description: "A shop that was not approved." }
    });
    expect(extra.isError).toBe(true);
    expect(textOf(extra)).toContain("Refused:");

    const order = await client.callTool({
      name: "file_change_order",
      arguments: {
        engagementId,
        kind: "discount_rate",
        summary: "Client asked for a lower day rate.",
        rateCode: "build-day",
        amountMinor: 7000
      }
    });
    const changeOrderId = JSON.parse(textOf(order)).id as string;
    const applied = await client.callTool({
      name: "approve_change_order",
      arguments: { engagementId, changeOrderId, confirmed: true }
    });
    const record = JSON.parse(textOf(applied));
    expect(record.rates[0].amountMinor).toBe(7000);

    const read = await client.callTool({ name: "get_approved_record", arguments: { engagementId } });
    expect(textOf(read)).toContain("Do not invent a discount");
    expect(JSON.parse(textOf(read)).rates[0].amountMinor).toBe(7000);
  });

  it("accepts rate-code case variants, lists allowed values, and finds the saved rate", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "scope-"));
    const client = await connect({ userId: "user-1", entitled: true, store: createFileScopeStore(path.join(dir, "scope.json")) });
    const created = await client.callTool({
      name: "create_engagement",
      arguments: { clientName: "Harbor Dental", title: "Website redesign", currency: "usd" }
    });
    expect(created.isError).toBeFalsy();
    const engagement = JSON.parse(textOf(created)).engagement as { id: string; currency: string };
    expect(engagement.currency).toBe("USD");
    const engagementId = engagement.id;
    await client.callTool({
      name: "save_scope_item",
      arguments: { engagementId, title: "Homepage design", description: "One homepage design with two revision rounds." }
    });

    const upper = await client.callTool({
      name: "save_rate",
      arguments: { engagementId, code: "DAY", label: "Design and build day rate", amountMinor: 65000, unit: "DAY" }
    });
    expect(upper.isError).toBeFalsy();
    const saved = JSON.parse(textOf(upper)) as { id: string; code: string; unit: string; label: string };
    expect(saved.code).toBe("day");
    expect(saved.unit).toBe("day");
    expect(saved.label).toBe("Design and build day rate");

    const mixed = await client.callTool({
      name: "save_rate",
      arguments: { engagementId, code: "Day", label: "Design and build day rate", amountMinor: 70000, unit: "Day" }
    });
    expect(mixed.isError).toBeFalsy();
    const updated = JSON.parse(textOf(mixed)) as { id: string; code: string; amountMinor: number };
    expect(updated.id).toBe(saved.id);
    expect(updated.code).toBe("day");
    expect(updated.amountMinor).toBe(70000);

    const invalid = await client.callTool({
      name: "save_rate",
      arguments: { engagementId, code: "DAY RATE", label: "Bad", amountMinor: 100, unit: "day" }
    });
    expect(invalid.isError).toBe(true);
    expect(textOf(invalid)).toContain(INVALID_RATE_CODE);
    expect(textOf(invalid)).toContain("Allowed values");
    expect(textOf(invalid)).toContain("a-z");
    expect(textOf(invalid)).toContain("0-9");
    expect(textOf(invalid)).toContain("hyphen");

    const badUnit = await client.callTool({
      name: "save_rate",
      arguments: { engagementId, code: "week", label: "Week", amountMinor: 100, unit: "WEEK" }
    });
    expect(badUnit.isError).toBe(true);
    expect(textOf(badUnit)).toContain("hour");
    expect(textOf(badUnit)).toContain("day");
    expect(textOf(badUnit)).toContain("fixed");

    const badCurrency = await client.callTool({
      name: "create_engagement",
      arguments: { clientName: "Ada", title: "Audit", currency: "US1" }
    });
    expect(badCurrency.isError).toBe(true);
    expect(textOf(badCurrency)).toContain(INVALID_CURRENCY);

    await client.callTool({ name: "approve_scope", arguments: { engagementId, confirmed: true } });
    const order = await client.callTool({
      name: "file_change_order",
      arguments: {
        engagementId,
        kind: "DISCOUNT_RATE",
        summary: "Client asked for a lower day rate.",
        rateCode: "DAY",
        amountMinor: 60000
      }
    });
    expect(order.isError).toBeFalsy();
    const filed = JSON.parse(textOf(order)) as { id: string; rateCode: string; kind: string };
    expect(filed.kind).toBe("discount_rate");
    expect(filed.rateCode).toBe("day");

    const read = await client.callTool({ name: "get_approved_record", arguments: { engagementId } });
    const record = JSON.parse(textOf(read)) as {
      rates: Array<{ code: string; amountMinor: number }>;
      proposedChangeOrders: Array<{ rateCode: string }>;
    };
    expect(record.rates.map((rate) => rate.code)).toEqual(["day"]);
    expect(record.rates[0]?.amountMinor).toBe(70000);
    expect(record.proposedChangeOrders[0]?.rateCode).toBe("day");

    const applied = await client.callTool({
      name: "approve_change_order",
      arguments: { engagementId, changeOrderId: filed.id, confirmed: true }
    });
    expect(JSON.parse(textOf(applied)).rates[0].amountMinor).toBe(60000);

    const badKind = await client.callTool({
      name: "file_change_order",
      arguments: { engagementId, kind: "nope", summary: "Not a real kind." }
    });
    expect(badKind.isError).toBe(true);
    for (const allowed of ["add_work", "discount_rate", "add_rate", "move_deadline"]) {
      expect(textOf(badKind)).toContain(allowed);
    }
  });

  it("keeps published tool names, descriptions, annotations, and schemas", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "scope-"));
    const client = await connect({ userId: "", entitled: false, store: createFileScopeStore(path.join(dir, "scope.json")) });
    const listed = await client.listTools();
    const byName = Object.fromEntries(listed.tools.map((tool) => [tool.name, tool]));
    const saveRate = byName.save_rate;
    const fileOrder = byName.file_change_order;
    const createEngagement = byName.create_engagement;
    expect(saveRate?.description).toBe(
      "Set a draft rate, or update an approved rate without lowering it or changing its unit. A lower amount is a discount and is refused. A new rate code after approval is refused. Use file_change_order and approve_change_order for those."
    );
    expect(saveRate?.annotations).toEqual({
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false
    });
    expect(fileOrder?.description).toBe(
      "Record a proposed change order. This does not change scope, rates, or deadlines. kind add_work requires workTitle and workDescription. kind discount_rate requires rateCode and a lower amountMinor. kind add_rate requires rateCode, rateLabel, amountMinor, and unit. kind move_deadline requires scopeItemId and dueOn."
    );
    expect(createEngagement?.description).toBe(
      "Create a draft engagement. Draft terms are not an approved commitment until approve_scope."
    );
    const properties = (tool: (typeof listed.tools)[number] | undefined) =>
      (tool?.inputSchema as { properties?: Record<string, unknown> }).properties ?? {};
    expect(properties(saveRate).code).toEqual({ type: "string", minLength: 1, maxLength: 40 });
    expect(properties(saveRate).unit).toEqual({ type: "string", enum: ["hour", "day", "fixed"] });
    expect(properties(fileOrder).kind).toEqual({
      type: "string",
      enum: ["add_work", "discount_rate", "add_rate", "move_deadline"]
    });
    expect(properties(fileOrder).rateCode).toEqual({ type: "string", minLength: 1, maxLength: 40 });
    expect(properties(fileOrder).unit).toEqual({ type: "string", enum: ["hour", "day", "fixed"] });
    expect(properties(createEngagement).currency).toEqual({ type: "string", pattern: "^[A-Z]{3}$" });
  });
});
