import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { app, runtimeDeps } from "./app.js";
import { createScopeMcpServer } from "./scope-tools.js";
import { useStdioTransport } from "./transport.js";

export { app };
export default app;
export { useStdioTransport };

const port = Number(process.env.PORT ?? 3000);
if (process.env.NODE_ENV !== "test") {
  // A terminal keeps the HTTP listener only. Glama attaches stdin and speaks MCP there.
  const stdio = useStdioTransport(process.stdin.isTTY);
  app.listen(port, () => {
    const line = `Scope listening on ${port}`;
    if (stdio) console.error(line);
    else console.log(line);
  });
  if (stdio) {
    const stdioServer = createScopeMcpServer({ userId: "", entitled: false, store: runtimeDeps.store });
    await stdioServer.connect(new StdioServerTransport());
  }
}
