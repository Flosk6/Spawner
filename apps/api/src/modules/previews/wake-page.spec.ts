import { describe, expect, it } from "vitest";
import { wakePage } from "./wake-page";

const view = { environment: "feat-login", project: "blog", dashboardUrl: "http://spawner.localtest.me/environments/env-1" };

describe("wakePage", () => {
  it("waits and reloads while the environment wakes up", () => {
    const html = wakePage({ ...view, state: "waking", message: "Starting again." });
    expect(html).toContain("Waking up: feat-login (blog)");
    expect(html).toContain('url.searchParams.set("__spawner_wake", "status")');
    expect(html).toContain("window.location.reload()");
  });

  it("says why it does not wake up, without polling, and escapes what it shows", () => {
    const html = wakePage({ ...view, state: "failed", message: 'relation "users" <does not exist>' });
    expect(html).toContain("relation &quot;users&quot; &lt;does not exist&gt;");
    expect(html).not.toContain("<script>");
  });
});
