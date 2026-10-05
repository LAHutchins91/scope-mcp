import type { Express } from "express";
import { TRIAL_PERIOD_DAYS } from "./access.js";
import { connectPageBody, landingConnectLead } from "./connect-page.js";
import { canonicalPublicOrigin } from "./public-url.js";

export const logo = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256"><rect width="256" height="256" rx="56" fill="#101820"/><rect x="48" y="64" width="160" height="128" rx="16" fill="none" stroke="#7dcea0" stroke-width="16"/><path d="M80 112h96M80 144h64" stroke="#f4d35e" stroke-width="12" stroke-linecap="round"/></svg>`;

const shell = (title: string, body: string) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} · Scope</title><link rel="icon" href="/icon.svg"><style>
body{margin:0;background:#101820;color:#f4f7f5;font:17px/1.6 system-ui}main{max-width:840px;margin:40px auto;padding:24px}a{color:#9be7b8}h1{line-height:1.15;font-size:40px}h2{margin-top:32px}nav,footer{display:flex;flex-wrap:wrap;gap:18px}section{border:1px solid #2c4a3e;border-radius:16px;padding:22px;margin:22px 0}button,input,textarea{font:inherit;box-sizing:border-box}button{cursor:pointer;padding:12px 16px;border-radius:10px;border:0;background:#1f7a4d;color:#fff;margin:8px 8px 8px 0}button.secondary{background:transparent;border:1px solid #6d8f7c;color:#f4f7f5}input,textarea{width:100%;padding:10px;border:1px solid #6d8f7c;border-radius:8px;background:#0c1411;color:inherit}label{display:block;margin:12px 0}code,pre{overflow-wrap:anywhere}pre{overflow:auto;background:#0c1411;padding:12px;border-radius:8px}[hidden]{display:none!important}#message{white-space:pre-wrap}
</style></head><body><main><nav><a href="/">Scope</a><a href="/connect">Connect an assistant</a><a href="/support">Support</a></nav><h1>${title}</h1>${body}<footer><a href="/privacy">Privacy</a><a href="/terms">Terms</a><a href="/support">Support</a></footer></main></body></html>`;

export function page(title: string, body: string): string {
  return shell(title, body);
}

function jsonForScript(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

export function landingPage(input: { appBaseUrl: string; supabaseUrl: string; supabaseAnonKey: string }): string {
  const origin = canonicalPublicOrigin(input.appBaseUrl);
  const configured = Boolean(input.supabaseUrl && input.supabaseAnonKey);
  const config = jsonForScript({
    url: input.supabaseUrl,
    key: input.supabaseAnonKey,
    base: origin
  });
  const oauthNote = configured
    ? `<p>Sign in with your account. Do not paste an API key or password into an MCP header.</p>`
    : `<p>OAuth is not configured on this process yet. Set the authorization server environment before asking an assistant to sign in. Do not paste an API key into a header.</p>`;
  return shell("Approved scope for assistants", `${landingConnectLead(origin)}
<p>Scope keeps a freelancer's approved scope, rates, deadlines, and change orders. An assistant reads that record before it answers. It cannot invent a discount or promise work that was not approved.</p>
${oauthNote}
<p id="signedOut">Scope tools need Pro or an active trial.</p>
<section id="account" hidden><p id="email"></p><p id="status" role="status"></p><button class="secondary" id="signOut" type="button">Sign out</button><button class="secondary" id="refresh" type="button">Refresh subscription status</button></section>
<section id="plans"><h2>Trial, then Pro</h2><p>Start a ${TRIAL_PERIOD_DAYS}-day trial. Billing interval and payment terms are shown at checkout. This page does not list an amount.</p>
<button type="button" class="checkout" data-plan="monthly">Start monthly trial</button>
<button type="button" class="checkout" data-plan="annual">Start yearly trial</button></section>
<p id="message" role="status"></p>
${configured ? `<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.115.0/dist/umd/supabase.js"></script>` : ""}
<script>
(function(){
  var cfg=${config};
  var token="";
  var client=null;
  function el(id){return document.getElementById(id)}
  function say(text){el("message").textContent=text}
  async function loadAccount(){
    var response=await fetch("/api/account",{headers:{Authorization:"Bearer "+token}});
    var body=await response.json();
    if(!response.ok) throw new Error(body.error||"Sign in again.");
    el("email").textContent=body.email||"Signed in";
    el("status").textContent=body.subscriptionStatus==="trialing"?"Scope Pro · Trial in progress":body.subscriptionStatus==="active"?"Scope Pro · Active":"Signed in. Start a ${TRIAL_PERIOD_DAYS}-day trial to use Scope tools.";
    el("account").hidden=false;
    el("signedOut").hidden=true;
    el("plans").hidden=Boolean(body.access);
  }
  function signedOut(){token="";el("account").hidden=true;el("signedOut").hidden=false;el("plans").hidden=false}
  document.querySelectorAll(".checkout").forEach(function(button){
    button.onclick=async function(){
      if(!cfg.url||!cfg.key){say("Sign-in is not configured on this server yet.");return}
      if(!token){say("Sign in first, then start a trial.");return}
      button.disabled=true;
      try{
        var response=await fetch("/billing/checkout",{method:"POST",headers:{"Content-Type":"application/json",Authorization:"Bearer "+token},body:JSON.stringify({plan:button.getAttribute("data-plan")})});
        var body=await response.json();
        if(!response.ok) throw new Error(body.error||"Unable to start checkout");
        location.href=body.url;
      }catch(error){say(error.message);button.disabled=false}
    };
  });
  if(!cfg.url||!cfg.key||!window.supabase){signedOut();return}
  client=window.supabase.createClient(cfg.url,cfg.key,{auth:{flowType:"implicit",persistSession:true,detectSessionInUrl:true,autoRefreshToken:true}});
  function resumePlugin(){
    try{
      var saved=sessionStorage.getItem("scopePluginReturn"); if(!saved) return false;
      sessionStorage.removeItem("scopePluginReturn");
      var pending=JSON.parse(saved);
      if(!pending||typeof pending.createdAt!=="number"||Date.now()-pending.createdAt>600000) return false;
      location.assign(pending.id?"/oauth/consent?authorization_id="+encodeURIComponent(pending.id):"/connections");
      return true;
    }catch(error){return false}
  }
  client.auth.onAuthStateChange(function(_event,session){
    token=session&&session.access_token?session.access_token:"";
    if(token){ if(resumePlugin()) return; loadAccount().catch(function(error){say(error.message)}); }
    else signedOut();
  });
  client.auth.getSession().then(function(result){
    var session=result.data&&result.data.session;
    token=session&&session.access_token?session.access_token:"";
    if(token){ if(resumePlugin()) return; return loadAccount(); }
    signedOut();
  }).catch(function(error){say(error.message)});
  var google=document.createElement("button");
  google.type="button";
  google.textContent="Continue with Google";
  el("signedOut").appendChild(google);
  google.onclick=async function(){
    google.disabled=true;
    try{var result=await client.auth.signInWithOAuth({provider:"google",options:{redirectTo:cfg.base+"/"}});if(result.error) throw result.error}
    catch(error){say(error.message||String(error));google.disabled=false}
  };
  el("signOut").onclick=async function(){await client.auth.signOut();signedOut();location.href="/"};
  el("refresh").onclick=function(){if(token) loadAccount().catch(function(error){say(error.message)})};
  var checkout=new URLSearchParams(location.search).get("checkout");
  if(checkout==="success") say("Checkout completed. Your subscription is being confirmed.");
  if(checkout==="cancelled") say("Checkout was cancelled. No changes were made.");
})();
</script>`);
}

export function installPublicPages(app: Express, baseUrl: string, supabaseUrl: string, supabaseAnonKey: string) {
  app.get("/icon.svg", (_req, res) => res.type("svg").send(logo));
  app.get("/connect", (_req, res) => res.type("html").send(page("Connect an assistant", connectPageBody(baseUrl))));
  app.get("/access", (_req, res) => res.type("html").send(page("Scope access", `<p>Scope tools are available with an active Pro subscription or trial. This connection has no entitlement at present. It cannot change your plan or start a purchase.</p><p><a href="/">Review the account</a> or <a href="/support">contact support</a> if access looks incorrect.</p>`)));
  app.get("/privacy", (_req, res) => res.type("html").send(page("Privacy policy", `<p>Effective October 5, 2026. Scope is operated by Ouroboros Apps (Lawrence Hutchins). Contact the operator through the <a href="/support">support form</a>.</p>
<h2>Information we process</h2>
<p>We process account identifiers and email provided at sign-in, subscription status and billing references, and the freelance records you intentionally save: engagements (including the client name and title you enter), scope items, rates, deadlines, and change orders. Support requests contain the reply email and message you provide.</p>
<p>We do not receive every assistant conversation. Tools receive only their submitted arguments. Do not include passwords, payment card details, or unrelated personal information in scope records.</p>
<h2>Why and where</h2>
<p>We use this information to provide Scope, authenticate users, enforce subscriptions, respond to support, prevent abuse, and meet legal obligations. Supabase provides authentication. Vercel hosts the public service; a copy you run yourself stores records on that host. Google provides optional sign-in. Stripe processes subscription payments. We do not store complete card numbers. Connected MCP clients, including ChatGPT, Claude, Gemini, Grok, Cursor, and other hosts you authorize, receive the scope records their authorized tools request and apply their own privacy terms. Service providers may process information outside your country.</p>
<h2>Control and retention</h2>
<p>We do not sell scope records or use them to train our own models. Saved engagements, scope items, rates, deadlines, and change orders remain until you request deletion through the <a href="/support">support form</a>. Disconnecting an assistant stops future tool access and does not by itself delete the saved record. Scope does not offer a self-serve export page; contact support if you need a copy of what we hold. Deletion removes the live engagements and related scope items, rates, deadlines, and change orders stored for that account. Provider backups may persist according to provider retention and are not an instant erasure guarantee. Billing records may be retained for required accounting or dispute handling.</p>
<p>Use the <a href="/support">support form</a> to request account deletion, correction, access, or questions about retention. Support records are kept while resolving the request and as needed for security or legal obligations. The service uses sign-in storage to maintain your session. No advertising trackers are included.</p>
<h2>Security and changes</h2>
<p>Sign-in is required before tools can read or change a record, and each account's records are kept separate. No service can promise absolute security. We publish policy changes here with an updated effective date. If local privacy law gives you additional rights, you may exercise them through support.</p>`)));
  app.get("/terms", (_req, res) => res.type("html").send(page("Terms of service", `<p>Effective October 4, 2026. These terms govern Scope, offered under the Hutchins App Studio brand. Questions go through <a href="/support">support</a>.</p><h2>Your records</h2><p>You retain rights in the scope, rates, deadlines, and change orders you submit. You grant the operator permission to host and transmit them only to provide the service. Submit only information you have the right to use.</p><h2>Accounts and paid access</h2><p>Scope tools require Pro or an active trial. A new subscription starts with a ${TRIAL_PERIOD_DAYS}-day trial. Billing interval, trial end, and payment terms are shown at checkout. This service does not display an amount on its own pages. Manage cancellation through the billing portal. Cancellation does not delete saved records.</p><h2>Limits</h2><p>The assistant chooses when to call tools. Scope refuses a lower rate and new work that lacks an approved change order, and it cannot promise that every assistant will ask before it speaks. Review the approved record.</p>`)));
  app.get("/support", (_req, res) => res.type("html").send(page("Contact Scope", `<section><h2>Use with Grok</h2><ol><li>Go to <a href="https://grok.com/connectors">grok.com/connectors</a>.</li><li>Choose New Connector → Custom.</li><li>Paste <code>https://scope-continuity2.vercel.app/mcp</code>.</li><li>Sign in.</li></ol><p>Full install steps for every assistant are on <a href="/connect">Connect an assistant</a>.</p></section><p>Send a support, billing, or privacy request. Do not include passwords, tokens, or payment card details.</p><form id="support"><label>Reply email<input name="email" type="email" required maxlength="254"></label><label>How can we help?<textarea name="message" required minlength="10" maxlength="4000" rows="7"></textarea></label><button>Send request</button></form><p id="message" role="status"></p><script>document.getElementById("support").onsubmit=async function(event){event.preventDefault();var button=this.querySelector("button");button.disabled=true;try{var response=await fetch("/api/support",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({email:this.email.value,message:this.message.value})});var body=await response.json();if(!response.ok) throw Error(body.error||"Unable to send");document.getElementById("message").textContent="Request received. Reference: "+body.id;this.reset()}catch(error){document.getElementById("message").textContent=error.message}finally{button.disabled=false}};</script>`)));
  app.get(["/", "/app"], (_req, res) => {
    res.type("html").send(landingPage({ appBaseUrl: baseUrl, supabaseUrl, supabaseAnonKey }));
  });
}
