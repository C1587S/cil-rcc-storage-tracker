#!/usr/bin/env node
// End-to-end identity check: real browser, real login gate, real WRITE.
//
// Exists because a "structurally audited" identity fix still failed in the
// browser. This exercises the actual login -> storage -> API-client -> 401
// chain and asserts the write both carries X-User and succeeds. The write
// used is dismiss + un-dismiss (self-reverting; leaves only two audit
// events, which is what audit events are for).
//
// Usage: node scripts/e2e-identity.js [base-url]
//   needs puppeteer:  npm i --no-save puppeteer   (or a global install)
const puppeteer = require("puppeteer");
const BASE = process.argv[2] || "http://localhost:3000/cil-rcc-tracker";
const USER = "cadavidsanchez";

(async () => {
  const browser = await puppeteer.launch({ headless: "new", args: ["--no-sandbox"] });
  const page = await browser.newPage();
  page.setDefaultTimeout(90000);
  const captured = [];
  page.on("request", r => {
    if (r.url().includes("/api/housekeeping") && r.method() !== "GET") {
      captured.push({ m: r.method(), u: r.url().split("/api/housekeeping")[1], x: r.headers()["x-user"] ?? null });
    }
  });
  const fails = [];
  const check = (ok, label) => { console.log((ok ? "  ok    " : "  FAIL  ") + label); if (!ok) fails.push(label); };

  try {
    await page.goto(BASE, { waitUntil: "networkidle2" });
    await page.waitForSelector("input[placeholder=username]");
    await page.type("input[placeholder=username]", USER);
    await page.click("button[type=submit]");
    await page.waitForFunction(() => !document.querySelector("input[placeholder=username]"));
    const stored = await page.evaluate(() => localStorage.getItem("cil-user"));
    check(stored === USER, `login writes cil-user (= ${JSON.stringify(stored)})`);

    await page.goto(BASE + "#housekeeping", { waitUntil: "networkidle2" });
    // Age tab loads by default; wait for a preview toggle
    await page.waitForFunction(() =>
      [...document.querySelectorAll("button")].some(b => b.textContent.trim() === "▸"));
    await page.evaluate(() =>
      [...document.querySelectorAll("button")].find(b => b.textContent.trim() === "▸").click());
    await page.waitForSelector('input[placeholder^="Why is this fine"]');
    await page.type('input[placeholder^="Why is this fine"]', "e2e identity check — auto-reverted");
    await page.evaluate(() =>
      [...document.querySelectorAll("button")].find(b => b.textContent.includes("Reviewed — dismiss")).click());
    // the dismissed row disappears from recon -> hidden counter appears
    await page.waitForFunction(() =>
      [...document.querySelectorAll("button")].some(b => b.textContent.includes("dismissed hidden")), { timeout: 30000 });
    const dis = captured.find(c => c.u.startsWith("/recon/dismissals") && c.m === "POST");
    check(!!dis, "dismiss request fired");
    check(dis?.x === USER, `dismiss carried X-User (= ${JSON.stringify(dis?.x)})`);

    // revert: show dismissed, click un-dismiss
    await page.evaluate(() =>
      [...document.querySelectorAll("button")].find(b => b.textContent.includes("dismissed hidden")).click());
    await page.waitForFunction(() =>
      [...document.querySelectorAll("button")].some(b => b.textContent.trim() === "un-dismiss"));
    await page.evaluate(() =>
      [...document.querySelectorAll("button")].find(b => b.textContent.trim() === "un-dismiss").click());
    await new Promise(r => setTimeout(r, 2500));
    const undis = captured.find(c => c.u.includes("/recon/dismissals/") && c.m === "DELETE");
    check(!!undis, "un-dismiss request fired");
    check(undis?.x === USER, `un-dismiss carried X-User (= ${JSON.stringify(undis?.x)})`);
  } catch (e) {
    fails.push("script error: " + e.message);
    console.log("  ERROR ", e.message);
  } finally {
    console.log("\ncaptured writes:");
    for (const c of captured) console.log(`  ${c.m.padEnd(6)} x-user=${String(c.x).padEnd(16)} ${c.u.slice(0, 60)}`);
    await browser.close();
  }
  if (fails.length) { console.log(`\nE2E IDENTITY: FAILED (${fails.length})`); process.exit(1); }
  console.log("\nE2E IDENTITY: PASSED — login-to-write identity chain works in a real browser.");
})();
