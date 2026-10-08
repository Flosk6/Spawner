/**
 * What the waiting page of a sleeping or stopped environment says:
 * waking (it reloads by itself once the environment answers), asleep (a
 * public URL does not wake it up), stopped, no_room (not enough memory to
 * wake it now), failed, or busy (another job runs).
 */
export type WakeState = "waking" | "ready" | "asleep" | "stopped" | "no_room" | "failed" | "busy";

export interface WakeView {
  state: WakeState;
  environment: string;
  project: string;
  message: string;
  /** The environment's page on the dashboard. */
  dashboardUrl: string;
}

const TITLES: Record<WakeState, string> = {
  waking: "Waking up",
  ready: "Ready",
  asleep: "Asleep",
  stopped: "Stopped",
  no_room: "Not enough memory",
  failed: "It could not start",
  busy: "Busy",
};

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] as string);
}

/**
 * The page a browser gets on the URL of a sleeping or stopped environment.
 * While it wakes up, the page asks the same URL for its state every two
 * seconds (?__spawner_wake=status) and reloads once the answer comes from
 * the application instead of Spawner.
 */
export function wakePage(view: WakeView): string {
  const polling = view.state === "waking" || view.state === "ready" || view.state === "busy";
  const name = `${view.environment} (${view.project})`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${escapeHtml(TITLES[view.state])}: ${escapeHtml(view.environment)}</title>
<style>
  :root { color-scheme: light dark; --bg: #f6f6f9; --fg: #17161d; --muted: #6b6a76; --accent: #574b89; --mark: #6e54ff; --card: #ffffff; --border: #e4e4ea; --dots: #dcdce4; }
  @media (prefers-color-scheme: dark) { :root { --bg: #0e0d13; --fg: #edecf3; --muted: #8d8c9b; --accent: #a99dff; --mark: #7d66ff; --card: #15141b; --border: #26252e; --dots: #1f1e27; } }
  body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center; background: var(--bg) radial-gradient(var(--dots) 1px, transparent 1.2px) 0 0 / 22px 22px; color: var(--fg); font: 15px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; -webkit-font-smoothing: antialiased; }
  main { max-width: 30rem; margin: 1rem; padding: 1.75rem; background: var(--card); border: 1px solid var(--border); border-radius: 14px; box-shadow: 0 10px 28px -8px rgba(0, 0, 0, 0.18); }
  .brand { display: flex; align-items: center; gap: 0.5rem; margin-bottom: 1.25rem; color: var(--muted); font-size: 0.8125rem; font-weight: 600; }
  .brand svg { width: 1.25rem; height: 1.25rem; color: var(--mark); }
  h1 { font-size: 1.0625rem; margin: 0 0 0.375rem; display: flex; align-items: center; gap: 0.625rem; }
  p { margin: 0.375rem 0; color: var(--muted); font-size: 0.875rem; }
  a { color: var(--accent); font-weight: 500; text-decoration: none; }
  a:hover { text-decoration: underline; }
  .spinner { width: 1rem; height: 1rem; border: 2px solid var(--border); border-top-color: var(--mark); border-radius: 50%; animation: spin 0.8s linear infinite; flex: none; }
  @keyframes spin { to { transform: rotate(360deg); } }
</style>
</head>
<body>
<main>
  <div class="brand" aria-hidden="true"><svg viewBox="0 0 32 32"><path fill="currentColor" fill-rule="evenodd" d="M16 1c3.3 2.5 5 6.1 5 10.3V17H11v-5.7C11 7.1 12.7 3.5 16 1z M16 6.8a2.2 2.2 0 1 0 0 4.4 2.2 2.2 0 0 0 0-4.4z M11 11.8l-3.4 3.9V20l3.4-2.4z M21 11.8l3.4 3.9V20L21 17.6z M13.2 17h5.6l-.8 2h-4z"/><path fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" d="M16 20.5v6.9 M16 20.5c0 2.3-1.9 3.1-4.1 3.1-1.9 0-2.9 1-2.9 2.6 M16 20.5c0 2.3 1.9 3.1 4.1 3.1 1.9 0 2.9 1 2.9 2.6"/><path fill="currentColor" d="M9 29.6a2 2 0 1 0 0-4 2 2 0 0 0 0 4z M23 29.6a2 2 0 1 0 0-4 2 2 0 0 0 0 4z M16 31.4a2 2 0 1 0 0-4 2 2 0 0 0 0 4z"/></svg>Spawner</div>
  <h1>${polling ? '<span class="spinner" aria-hidden="true"></span>' : ""}<span id="title">${escapeHtml(TITLES[view.state])}: ${escapeHtml(name)}</span></h1>
  <p id="message">${escapeHtml(view.message)}</p>
  <p><a href="${escapeHtml(view.dashboardUrl)}">Open it in Spawner</a></p>
</main>
${
  polling
    ? `<script>
(function () {
  var url = new URL(window.location.href);
  url.searchParams.set("__spawner_wake", "status");
  var started = Date.now();
  function show(text) { document.getElementById("message").textContent = text; }
  function poll() {
    if (Date.now() - started > 10 * 60 * 1000) { show("This takes longer than usual. Reload the page in a moment, or open it in Spawner."); return; }
    fetch(url.toString(), { credentials: "same-origin", cache: "no-store", headers: { Accept: "application/json" } })
      .then(function (response) {
        if (!response.headers.get("x-spawner-wake")) { window.location.reload(); return null; }
        return response.json();
      })
      .then(function (body) {
        if (!body) { return; }
        if (body.state === "ready") { show(body.message); setTimeout(function () { window.location.reload(); }, 1000); return; }
        if (body.state === "waking" || body.state === "busy") { setTimeout(poll, 2000); return; }
        show(body.message);
      })
      .catch(function () { setTimeout(poll, 3000); });
  }
  setTimeout(poll, 2000);
})();
</script>`
    : ""
}
</body>
</html>`;
}
