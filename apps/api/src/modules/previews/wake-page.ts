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
  no_room: "Not enough room",
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
  :root { color-scheme: light dark; --bg: #f8fafc; --fg: #0f172a; --muted: #64748b; --accent: #7c3aed; --card: #ffffff; --border: #e2e8f0; }
  @media (prefers-color-scheme: dark) { :root { --bg: #0b0b14; --fg: #e2e8f0; --muted: #94a3b8; --card: #15151f; --border: #2a2a3a; } }
  body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center; background: var(--bg); color: var(--fg); font: 16px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
  main { max-width: 32rem; margin: 1rem; padding: 2rem; background: var(--card); border: 1px solid var(--border); border-radius: 12px; }
  h1 { font-size: 1.25rem; margin: 0 0 0.5rem; display: flex; align-items: center; gap: 0.75rem; }
  p { margin: 0.5rem 0; color: var(--muted); }
  a { color: var(--accent); }
  .spinner { width: 1.1rem; height: 1.1rem; border: 3px solid var(--border); border-top-color: var(--accent); border-radius: 50%; animation: spin 0.9s linear infinite; flex: none; }
  @keyframes spin { to { transform: rotate(360deg); } }
</style>
</head>
<body>
<main>
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
