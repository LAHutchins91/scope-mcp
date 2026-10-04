import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PRO_REQUIRED, SIGN_IN_REQUIRED } from "../src/access.js";
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
});
