# Scope

Scope keeps a freelancer's approved scope, rates, deadlines, and change orders, then lets an assistant read that record before it answers. An assistant cannot invent a discount or promise work that was not approved.

It works with ChatGPT, Claude, Gemini, Grok, and Cursor, plus any other MCP client that can do Streamable HTTP and OAuth. It is not a ChatGPT-only plugin.

Sign in with your Scope account when the assistant opens OAuth. Do not paste an API key or password into a header. Scope supports dynamic client registration: leave the client id and secret empty. The protected-resource metadata at `/.well-known/oauth-protected-resource/mcp` points clients at the OAuth issuer, which registers them.

Scope tools need Pro or an active trial. A new subscription includes a 14-day trial. This page does not list an amount. Checkout shows the billing interval and payment terms.

Run the server yourself and use the base URL you configure. The default local MCP address is `http://127.0.0.1:3000/mcp`.

## What the assistant can do

After you approve the connection, the server exposes these tools:

- list_engagements
- create_engagement
- get_approved_record
- save_scope_item
- save_rate
- save_deadline
- approve_scope
- file_change_order
- approve_change_order

`get_approved_record` is the read the assistant should do before it answers. Draft terms are not an approved commitment. A proposed change order does not change the record. After the scope is approved, `save_rate` refuses a lower rate, and `save_scope_item` refuses new work. Those changes go through `file_change_order` and then `approve_change_order`, and only when you explicitly approve that order.

The assistant only calls these tools when you and the host allow it.

## Connect

Cursor, in `~/.cursor/mcp.json` or a project `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "scope": {
      "url": "http://127.0.0.1:3000/mcp"
    }
  }
}
```

Do not add a headers block. Cursor registers a client and opens sign-in.

Claude Code:

```bash
claude mcp add --transport http scope http://127.0.0.1:3000/mcp
```

Do not pass an Authorization header. Other clients use the same address, choose OAuth, and leave client id and secret empty. Steps for ChatGPT, Claude, Gemini, Grok, and Cursor are on the connect page at `/connect`.

Registry metadata for this server is in `server.json` (`io.github.LAHutchins91/scope`). The public remote URL there is `https://scope-continuity2.vercel.app/mcp`.

## Run

```bash
npm install
npm test
npm run typecheck
npm run build
npm start
```

When stdin is a terminal, Scope serves Streamable HTTP on port 3000. When stdin is not a terminal, it speaks MCP over stdio and still opens the HTTP port. Logs during stdio mode go to stderr so they do not mix with the protocol.

Records are stored durably in a JSON file. The default path is `~/.scope/scope.json`. Set `SCOPE_DATA_PATH` to move it. One server process owns that file.

OAuth uses the same idea as a Supabase authorization server with dynamic client registration. Set these on the server process, not in an MCP header:

- `APP_BASE_URL` (default `http://localhost:3000`)
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `STRIPE_PRICE_MONTHLY` and `STRIPE_PRICE_YEARLY` (Stripe catalog ids, not amounts)
- `OPENAI_APPS_CHALLENGE` (optional). When set, `GET /.well-known/openai-apps-challenge` returns that token as plain text for OpenAI domain verification. When unset, the route responds with `404` and the text `Verification is not configured.`

Tool calls other than discovery require a signed-in account whose subscription status is `active` or `trialing`.

---

More from Ouroboros: https://ouroborosapps.com
