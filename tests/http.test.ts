import { createServer, request as httpRequest, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import crypto from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Express, Request } from "express";
import { afterEach, describe, expect, it } from "vitest";
import { PRO_REQUIRED, SIGN_IN_REQUIRED } from "../src/access.js";
import scopeApp, { createApp, type ScopeDeps } from "../src/app.js";
import { protectedResourceMetadata } from "../src/plugin-auth.js";
import { createFileScopeStore } from "../src/scope-store.js";
import { SCOPE_TOOL_NAMES } from "../src/scope-tools.js";

const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  })));
});

async function listen(app: Express): Promise<string> {
  const server = createServer(app);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}

async function deps(status = "none"): Promise<ScopeDeps & { file: string }> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "scope-"));
  const file = path.join(dir, "scope.json");
  const store = createFileScopeStore(file);
  await store.updateProfile("user-1", { subscriptionStatus: status });
  const appBaseUrl = "http://127.0.0.1:3000";
  return {
    file,
    appBaseUrl,
    supabaseUrl: "https://example.supabase.co",
    supabaseAnonKey: "public-anon",
    stripeSecretKey: "sk_test",
    stripeWebhookSecret: "whsec_test",
    stripePriceMonthly: "catalog_monthly",
    stripePriceYearly: "catalog_yearly",
    store,
    authenticate: async (req: Request) => {
      const header = req.header("authorization") ?? "";
      if (header !== "Bearer good-token") throw new Error("Authentication required");
      return { user: { id: "user-1", email: "freelancer@example.com" }, token: "good-token" };
    },
    validateClaims: (token: string) => {
      if (token !== "good-token") throw new Error("Reconnect Scope");
    }
  };
}

function mcpHeaders(origin?: string): Record<string, string> {
  return {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    ...(origin ? { origin } : {})
  };
}

function postMcp(
  url: string,
  headers: Record<string, string>,
  body: unknown
): Promise<{ status: number; payload: unknown }> {
  const payload = JSON.stringify(body);
  const target = new URL(url);
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        hostname: target.hostname,
        port: target.port,
        path: target.pathname,
        method: "POST",
        headers: {
          "content-type": "application/json",
          "content-length": Buffer.byteLength(payload),
          ...headers
        }
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          let parsed: unknown = text;
          try {
            parsed = text ? JSON.parse(text) : null;
          } catch {
            parsed = text;
          }
          resolve({ status: res.statusCode ?? 0, payload: parsed });
        });
      }
    );
    req.on("error", reject);
    req.end(payload);
  });
}

describe("HTTP MCP", () => {
  it("default-exports the Express app so Vercel can serve tools/list", async () => {
    expect(typeof scopeApp).toBe("function");
    expect(typeof scopeApp.listen).toBe("function");
    const url = await listen(scopeApp);
    const response = await fetch(`${url}/mcp`, {
      method: "POST",
      headers: mcpHeaders(),
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" })
    });
    expect(response.status).toBe(200);
    const body = await response.json() as { result: { tools: Array<{ name: string }> } };
    expect(body.result.tools.map((tool) => tool.name).sort()).toEqual([...SCOPE_TOOL_NAMES].sort());
  });

  it("returns Scope tools from tools/list without a credential", async () => {
    const options = await deps();
    const url = await listen(createApp(options));
    const response = await fetch(`${url}/mcp`, {
      method: "POST",
      headers: mcpHeaders(),
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" })
    });
    expect(response.status).toBe(200);
    const body = await response.json() as { result: { tools: Array<{ name: string }> } };
    expect(body.result.tools.map((tool) => tool.name).sort()).toEqual([...SCOPE_TOOL_NAMES].sort());
  });

  it("lists tools when Accept is missing or incomplete and still requires auth for tool calls", async () => {
    const options = await deps();
    const url = await listen(createApp(options));
    const list = { jsonrpc: "2.0", id: 1, method: "tools/list" };
    const accepts: Array<Record<string, string>> = [
      { accept: "application/json" },
      { accept: "*/*" },
      { accept: "text/event-stream" },
      {},
      { accept: "application/json, text/event-stream" }
    ];
    for (const headers of accepts) {
      const response = await postMcp(`${url}/mcp`, headers, list);
      expect(response.status, JSON.stringify(headers)).toBe(200);
      const body = response.payload as { result: { tools: Array<{ name: string }> } };
      expect(body.result.tools.map((tool) => tool.name).sort()).toEqual([...SCOPE_TOOL_NAMES].sort());
    }

    const anonymous = await postMcp(
      `${url}/mcp`,
      { accept: "application/json" },
      { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "list_engagements", arguments: {} } }
    );
    expect(anonymous.status).toBe(401);
    expect(anonymous.payload).toEqual({ error: SIGN_IN_REQUIRED });
  });

  it("requires OAuth and an active trial before a tool call", async () => {
    const locked = await deps("none");
    const lockedUrl = await listen(createApp(locked));
    const anonymous = await fetch(`${lockedUrl}/mcp`, {
      method: "POST",
      headers: mcpHeaders(),
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "list_engagements", arguments: {} } })
    });
    expect(anonymous.status).toBe(401);
    expect(anonymous.headers.get("www-authenticate")).toContain("/.well-known/oauth-protected-resource/mcp");
    await expect(anonymous.json()).resolves.toEqual({ error: SIGN_IN_REQUIRED });

    const forbidden = await fetch(`${lockedUrl}/mcp`, {
      method: "POST",
      headers: { ...mcpHeaders(), authorization: "Bearer good-token" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "list_engagements", arguments: {} } })
    });
    expect(forbidden.status).toBe(403);
    const forbiddenBody = await forbidden.json() as { error: string; access_information: string };
    expect(forbiddenBody.error).toBe(PRO_REQUIRED);
    expect(forbiddenBody.access_information).toBe("http://127.0.0.1:3000/access");

    const open = await deps("trialing");
    const openUrl = await listen(createApp(open));
    const allowed = await fetch(`${openUrl}/mcp`, {
      method: "POST",
      headers: { ...mcpHeaders("https://chatgpt.com"), authorization: "Bearer good-token" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 4,
        method: "tools/call",
        params: { name: "create_engagement", arguments: { clientName: "Ada", title: "Audit", currency: "GBP" } }
      })
    });
    expect(allowed.status).toBe(200);
    const allowedBody = await allowed.json() as { result: { content: Array<{ text: string }> } };
    expect(allowedBody.result.content[0]?.text).toContain("Audit");

    const evil = await fetch(`${openUrl}/mcp`, {
      method: "POST",
      headers: mcpHeaders("https://evil.example"),
      body: JSON.stringify({ jsonrpc: "2.0", id: 5, method: "tools/list" })
    });
    expect(evil.status).toBe(403);
  });

  it("advertises OAuth metadata and applies a trial from the billing webhook", async () => {
    const options = await deps("none");
    const url = await listen(createApp(options));
    const metadata = await fetch(`${url}/.well-known/oauth-protected-resource/mcp`);
    expect(await metadata.json()).toEqual(protectedResourceMetadata(options.appBaseUrl, options.supabaseUrl));

    const payload = JSON.stringify({
      type: "customer.subscription.updated",
      data: {
        object: {
          id: "sub_1",
          customer: "cus_1",
          status: "trialing",
          cancel_at_period_end: false,
          metadata: { scope_user_id: "user-1" }
        }
      }
    });
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = crypto.createHmac("sha256", options.stripeWebhookSecret).update(`${timestamp}.${payload}`).digest("hex");
    const webhook = await fetch(`${url}/billing/webhook`, {
      method: "POST",
      headers: { "content-type": "application/json", "stripe-signature": `t=${timestamp},v1=${signature}` },
      body: payload
    });
    expect(webhook.status).toBe(200);
    expect((await options.store.getProfile("user-1")).subscriptionStatus).toBe("trialing");

    const health = await fetch(`${url}/health`);
    expect(await health.json()).toMatchObject({ ok: true, service: "scope", oauthConfigured: true, billingConfigured: true });
  });

  it("serves the OpenAI domain challenge as plain text and a Continuity-grade privacy page", async () => {
    const previous = process.env.OPENAI_APPS_CHALLENGE;
    const options = await deps();
    const url = await listen(createApp(options));
    try {
      delete process.env.OPENAI_APPS_CHALLENGE;
      const missing = await fetch(`${url}/.well-known/openai-apps-challenge`);
      expect(missing.status).toBe(404);
      expect(missing.headers.get("content-type")).toMatch(/text\/plain/);
      const missingBody = await missing.text();
      expect(missingBody).toBe("Verification is not configured.");
      expect(missingBody).not.toContain("<");

      process.env.OPENAI_APPS_CHALLENGE = "portal-token-value";
      const present = await fetch(`${url}/.well-known/openai-apps-challenge`);
      expect(present.status).toBe(200);
      expect(present.headers.get("content-type")).toMatch(/text\/plain/);
      expect(await present.text()).toBe("portal-token-value");

      const privacy = await fetch(`${url}/privacy`);
      expect(privacy.status).toBe(200);
      expect(privacy.headers.get("content-type")).toMatch(/text\/html/);
      const html = await privacy.text();
      for (const section of [
        "Effective October 5, 2026",
        "Ouroboros Apps",
        "Lawrence Hutchins",
        "href=\"/support\"",
        "Information we process",
        "Why and where",
        "Control and retention",
        "Security and changes",
        "do not sell scope records",
        "ChatGPT",
        "Claude",
        "Gemini",
        "Grok",
        "Cursor",
        "Supabase",
        "Stripe",
        "Google"
      ]) {
        expect(html).toContain(section);
      }
      expect(html).not.toMatch(/\$\d/);

      const home = await fetch(`${url}/`);
      const homeHtml = await home.text();
      expect(homeHtml).toContain("Continue with Google");
      expect(homeHtml).toContain('provider:"google"');
    } finally {
      if (previous === undefined) delete process.env.OPENAI_APPS_CHALLENGE;
      else process.env.OPENAI_APPS_CHALLENGE = previous;
    }
  });
});
