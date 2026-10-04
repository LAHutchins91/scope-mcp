import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SCOPE_VERSION } from "../src/version.js";

const read = (file: string) => readFileSync(file, "utf8");

describe("packaging", () => {
  it("matches the Continuity registry, image, and maintainer list", () => {
    const glama = JSON.parse(read("glama.json")) as { maintainers: string[] };
    expect(glama.maintainers).toEqual(["LAHutchins91"]);
    const server = JSON.parse(read("server.json")) as { name: string; version: string; websiteUrl?: string; remotes: Array<{ type: string; url: string }> };
    expect(server.name).toBe("io.github.LAHutchins91/scope");
    expect(server.version).toBe(SCOPE_VERSION);
    expect(server.websiteUrl).toBeUndefined();
    expect(server.remotes).toEqual([{ type: "streamable-http", url: "http://127.0.0.1:3000/mcp" }]);
    const docker = read("Dockerfile");
    expect(docker).toContain("FROM node:22-alpine AS build");
    expect(docker).toContain("USER node");
    expect(docker).toContain("EXPOSE 3000");
    expect(docker).toContain('CMD ["node", "dist/src/server.js"]');
    const pkg = JSON.parse(read("package.json")) as { version: string; scripts: { start: string } };
    expect(pkg.version).toBe(SCOPE_VERSION);
    expect(pkg.scripts.start).toBe("node dist/src/server.js");
  });

  it("does not print a dollar amount in the README or server pages", () => {
    const files = ["README.md", "server.json", "glama.json"];
    const source = ["src", "README.md"].flatMap((entry) => entry.endsWith(".md") ? [read(entry)] : []);
    const pageSource = read("src/public-pages.ts") + read("src/connect-page.ts") + read("src/plugin-auth.ts") + read("src/scope-tools.ts") + read("src/scope-policy.ts") + read("src/access.ts");
    const blob = files.map(read).join("\n") + pageSource + source.join("\n");
    expect(blob).not.toMatch(/\$\s*\d/);
    expect(blob.toLowerCase()).not.toContain("dollar");
    const readme = read("README.md");
    for (const phrase of ["ChatGPT", "Claude", "Gemini", "Grok", "Cursor", "OAuth", "14-day trial", "dynamic client registration"]) {
      expect(readme).toContain(phrase);
    }
    expect(readme).toContain("Do not paste an API key or password into a header");
    expect(readme).not.toContain("Authorization:");
  });
});
