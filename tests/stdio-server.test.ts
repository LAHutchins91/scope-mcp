import { spawn } from "node:child_process";
import { describe, expect, it } from "vitest";
import { SCOPE_TOOL_NAMES } from "../src/scope-tools.js";

describe("stdio server", () => {
  it("answers tools/list when stdin is not a terminal", async () => {
    const child = spawn(process.execPath, ["--import", "tsx", "src/server.ts"], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, NODE_ENV: "production", PORT: "0" }
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    const send = (message: unknown) => {
      child.stdin.write(`${JSON.stringify(message)}\n`);
    };
    try {
      const started = Date.now();
      while (!stderr.includes("Scope listening")) {
        if (child.exitCode !== null) throw new Error(`server exited ${child.exitCode}\n${stderr}`);
        if (Date.now() - started > 15000) throw new Error(`server did not start\n${stderr}`);
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      send({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          clientInfo: { name: "scope-proof", version: "0.0.0" }
        }
      });
      send({ jsonrpc: "2.0", method: "notifications/initialized" });
      send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
      const deadline = Date.now() + 10000;
      while (!stdout.split("\n").some((line) => line.includes('"id":2'))) {
        if (Date.now() > deadline) throw new Error(`tools/list timed out\nstdout:${stdout}\nstderr:${stderr}`);
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      const listed = stdout.split("\n").map((line) => line.trim()).filter(Boolean).map((line) => JSON.parse(line) as { id?: number; result?: { tools?: Array<{ name: string }> } });
      const tools = listed.find((message) => message.id === 2)?.result?.tools?.map((tool) => tool.name) ?? [];
      expect(tools.sort()).toEqual([...SCOPE_TOOL_NAMES].sort());
    } finally {
      child.kill("SIGTERM");
      await new Promise((resolve) => child.once("exit", resolve));
    }
  }, 20000);
});
