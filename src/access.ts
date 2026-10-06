/** New subscriptions start with this trial, then Pro. Not an amount. */
export const TRIAL_PERIOD_DAYS = 14;

export const SIGN_IN_REQUIRED = "Sign in to Scope to use scope tools.";

export const PRO_REQUIRED = "This Scope account does not currently include access to Scope tools. Check that you connected the intended account.";

export const PUBLIC_MCP_METHODS = new Set([
  "initialize",
  "notifications/initialized",
  "tools/list",
  "ping"
]);

export function hasScopeAccess(status: string): boolean {
  return status === "active" || status === "trialing";
}
