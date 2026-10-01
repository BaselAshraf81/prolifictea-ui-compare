// Full-page headless Chrome captures over raw CDP (adapted from ui-redesign-3/live-shot.mjs).
//   node shoot.mjs <baseUrl> <outDir> [cdpPort]
import fs from "node:fs"; import { spawn } from "node:child_process"; import path from "node:path"; import os from "node:os";
const [B, OUT, CDP = "9351"] = process.argv.slice(2);
fs.mkdirSync(OUT, { recursive: true });
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const PAGES = [
  ["home", "/"], ["home-lowest-rated", "/?sort=lowest-rated"],
  ["researcher", "/researchers/cmolv95l10000ssub2iiayv6v"],
  ["stats", "/stats"], ["leaderboard", "/leaderboard"], ["guide", "/guide"],
  ["extension", "/extension"], ["about", "/about"], ["login", "/login"], ["register", "/register"],
];
const only = process.env.ONLY ? process.env.ONLY.split(",") : null;
const jobs = [];
for (const [name, url] of PAGES) { if (only && !only.includes(name)) continue; for (const w of [1440, 390]) for (const theme of ["light", "dark"]) jobs.push([name, url, w, theme]); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
try { await fetch(`http://127.0.0.1:${CDP}/json`); console.error(`CDP port ${CDP} already in use; aborting`); process.exit(2); } catch {}
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "ptcmp-"));
const proc = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${CDP}`, `--user-data-dir=${profile}`, "--no-first-run", "--hide-scrollbars", "--disable-gpu", "--disable-extensions", "--renderer-process-limit=1", "--js-flags=--max-old-space-size=512", "about:blank"], { stdio: "ignore" });
let target;
for (let i = 0; i < 60 && !target; i++) { try { target = (await (await fetch(`http://127.0.0.1:${CDP}/json`)).json()).find((t) => t.type === "page"); } catch {} if (!target) await sleep(300); }
const ws = new WebSocket(target.webSocketDebuggerUrl); await new Promise((r) => ws.addEventListener("open", r));
let id = 0; const pending = new Map(); const waiters = [];
ws.addEventListener("message", (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } if (m.method) for (const w of [...waiters]) if (w.method === m.method) { waiters.splice(waiters.indexOf(w), 1); w.resolve(m); } });
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const once = (method) => new Promise((resolve) => waiters.push({ method, resolve }));
const ev = async (expression) => (await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true })).result.result?.value;
await send("Page.enable"); await send("Runtime.enable"); await send("Network.enable");
// Hide the Next.js dev overlay badge; it is not part of the real UI.
await send("Page.addScriptToEvaluateOnNewDocument", { source: `document.addEventListener('DOMContentLoaded',()=>{const s=document.createElement('style');s.textContent='nextjs-portal{display:none!important}';document.head.appendChild(s)})` });
let themeScript;
const res = [];
for (const [name, url, w, theme] of jobs) {
  const file = `${name}-${w}-${theme}.png`;
  try {
    await send("Network.clearBrowserCookies");
    if (themeScript) await send("Page.removeScriptToEvaluateOnNewDocument", { identifier: themeScript });
    themeScript = (await send("Page.addScriptToEvaluateOnNewDocument", { source: `try{localStorage.setItem('theme','${theme}')}catch{}` })).result.identifier;
    await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: theme }] });
    await send("Emulation.setDeviceMetricsOverride", { width: w, height: 900, deviceScaleFactor: 1, mobile: w < 600 });
    const l = once("Page.loadEventFired");
    const nav = await send("Page.navigate", { url: B + url });
    if (nav.result?.errorText) throw new Error(nav.result.errorText);
    await Promise.race([l, sleep(90000)]);
    await ev("document.fonts.ready.then(()=>true)");
    await sleep(3000); // let client data, charts and animations settle
    // Wait until page height is stable for ~2.5s (client fetches done), max ~25s.
    await ev(`(async()=>{let last=-1,stable=0;for(let i=0;i<50&&stable<5;i++){const h=document.documentElement.scrollHeight;stable=h===last?stable+1:0;last=h;await new Promise(r=>setTimeout(r,500))}return true})()`);
    // Scroll through once so lazy content renders, then back to the top.
    await ev(`(async()=>{const h=document.documentElement.scrollHeight;for(let y=0;y<h;y+=800){scrollTo(0,y);await new Promise(r=>setTimeout(r,120))}scrollTo(0,0);return true})()`);
    await sleep(1200);
    const info = await ev(`(()=>{const de=document.documentElement;return {dark:de.classList.contains('dark'),h:de.scrollHeight,title:document.title,err:!!document.querySelector('nextjs-portal [data-nextjs-dialog]')}})()`);
    await send("Emulation.setDeviceMetricsOverride", { width: w, height: Math.min(info.h, 9000), deviceScaleFactor: 1, mobile: w < 600 });
    await sleep(800);
    const shot = await send("Page.captureScreenshot", { format: "png" });
    fs.writeFileSync(path.join(OUT, file), Buffer.from(shot.result.data, "base64"));
    res.push({ file, ...info });
    process.stderr.write(`ok ${file} h=${info.h} dark=${info.dark}\n`);
  } catch (e) { res.push({ file, error: String(e) }); process.stderr.write(`FAIL ${file} ${e}\n`); }
}
fs.writeFileSync(path.join(OUT, "_report.json"), JSON.stringify(res, null, 1));
ws.close(); spawn("taskkill", ["/PID", String(proc.pid), "/T", "/F"], { stdio: "ignore" }); await sleep(1500); try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
