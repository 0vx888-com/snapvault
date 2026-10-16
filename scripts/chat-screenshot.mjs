// 用法：node chat-screenshot.mjs <输出目录>（需要 playwright，并先启动 http://localhost:5173）
import { chromium } from "playwright";
const out = process.argv[2] || ".";
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1280, height: 860 } });
const errs = []; p.on("pageerror", (e) => errs.push(e.message)); p.on("dialog", (d) => d.accept());
await p.setContent(`<div style="width:300px;height:375px;background:linear-gradient(135deg,#ff2d75,#6a00ff)"></div>`);
await p.screenshot({ path: "/tmp/sample.png" });
await p.goto("http://localhost:5173/"); await p.evaluate(() => { localStorage.clear(); sessionStorage.clear(); }); await p.reload();
const chat = () => p.click('[data-tab="chat"]');
await chat(); await p.waitForSelector(".xc-item"); await p.click(".xc-item:has(b:text-is('小鹿'))");
await p.check("#chat-burn"); await p.fill("#chat-text", "这条只给你看 🤫"); await p.click("#chat-form .primary");
// 好友：接受 Mia 的请求，再用 UID 加阿杰之外的地址
await p.click("#xc-fr"); await p.click("[data-acc]"); await p.fill("#xc-fq", "0x1234567890abcdef1234567890abcdef12345678"); await p.click("#xc-fadd");
await p.waitForTimeout(200); await p.screenshot({ path: out + "/xchat-04-好友UID与请求.png" }); await p.click("#xc-fr");
await p.click(".xc-item:has-text('付费粉丝团')"); await p.waitForTimeout(300);
await p.screenshot({ path: out + "/xchat-01-付费群未购买被拦.png" });
// 去粉丝广场购买
await p.click('[data-tab="creator"]'); await p.setInputFiles("#file", "/tmp/sample.png"); await p.fill("#title", "独家幕后"); await p.fill("#secs", "3");
await p.click("button[type=submit]"); await p.waitForFunction(() => document.querySelector("#log").textContent.includes("TapeSend"));
await p.click('[data-tab="fan"]'); await p.click("[data-buy]"); await p.waitForSelector("#viewer.hidden", { state: "attached", timeout: 15000 });
await chat(); await p.click(".xc-item:has-text('付费粉丝团')"); await p.click("#xc-join");
await p.click("[data-open]"); await p.waitForTimeout(2200);
await p.screenshot({ path: out + "/xchat-02-加入付费群并阅后即焚.png" });
await p.keyboard.press("PrintScreen"); await p.waitForTimeout(300);
await p.waitForFunction(() => !document.querySelector(".cprog"), null, { timeout: 15000 });
await p.selectOption("#xc-me", "0xCreAt0r00000000000000000000000000000001"); await p.waitForTimeout(300);
await p.click(".xc-item:has-text('付费粉丝团')");
await p.selectOption("#chat-shot", "forbid"); await p.fill("#chat-text", "这条禁止截图（模糊加水印）"); await p.click("#chat-form .primary");
await p.screenshot({ path: out + "/xchat-05-截图通知与禁止截图(创作者).png" });
await p.selectOption("#xc-me", "0xFaN2000000000000000000000000000000000002"); await p.waitForTimeout(200); await p.click(".xc-item:has-text('付费粉丝团')"); await p.waitForTimeout(300);
await p.screenshot({ path: out + "/xchat-06-禁止截图消息(粉丝看到模糊水印).png" });
await p.selectOption("#xc-me", "0xCreAt0r00000000000000000000000000000001"); await p.waitForTimeout(200); await p.click(".xc-item:has-text('付费粉丝团')"); await p.click("#xc-new"); await p.waitForTimeout(300);
await p.screenshot({ path: out + "/xchat-03-创作者视角与新建群.png" });
const st = await p.evaluate(() => JSON.parse(localStorage.getItem("chat:msgs")).filter((m) => m.burn).map((m) => ({ viewed: m.viewed || [], cipher: !!m.env })));
console.log(JSON.stringify(st), "errors:", errs); await b.close();
