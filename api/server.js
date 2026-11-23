"use strict";
const http = require("node:http");
const nodemailer = require("nodemailer");

const PORT = Number(process.env.PORT || 3000);
const ALLOWED_ORIGINS = new Set([
  "https://max-cio.ru",
  "https://www.max-cio.ru",
  "https://skalozuboff-maximov-it-consulting-cfda.twc1.net"
]);
const WINDOW_MS = 10 * 60 * 1000;
const MAX_PER_WINDOW = 5;
const requests = new Map();

function sendJson(res, status, data, origin) {
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(data));
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", chunk => {
      raw += chunk;
      if (raw.length > 16_384) { reject(new Error("too_large")); req.destroy(); }
    });
    req.on("end", () => {
      try { resolve(JSON.parse(raw || "{}")); } catch { reject(new Error("bad_json")); }
    });
    req.on("error", reject);
  });
}
function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" })[c]);
}
function allowed(req) {
  const origin = req.headers.origin;
  return !origin || ALLOWED_ORIGINS.has(origin);
}
function rateLimited(ip) {
  const now = Date.now();
  const entry = requests.get(ip);
  if (!entry || now - entry.start > WINDOW_MS) {
    requests.set(ip, { start: now, count: 1 });
    return false;
  }
  entry.count += 1;
  return entry.count > MAX_PER_WINDOW;
}
async function deliver({ company, contact, task }) {
  const text = [
    "Новая заявка с сайта max-cio.ru",
    "",
    "Компания / отрасль: " + company,
    "Контакт для ответа: " + contact,
    "",
    "Задача:",
    task
  ].join("\n");
  const results = await Promise.allSettled([
    (async () => {
      if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_CHAT_ID) throw new Error("telegram_not_configured");
      const response = await fetch("https://api.telegram.org/bot" + process.env.TELEGRAM_BOT_TOKEN + "/sendMessage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: process.env.TELEGRAM_CHAT_ID, text, disable_web_page_preview: true })
      });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error("telegram_delivery_failed");
    })(),
    (async () => {
      const required = ["GMAIL_USER", "GMAIL_APP_PASSWORD"];
      if (required.some(key => !process.env[key])) throw new Error("email_not_configured");
      const transporter = nodemailer.createTransport({
        host: "smtp.gmail.com", port: 465, secure: true,
        auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD }
      });
      await transporter.sendMail({
        from: process.env.GMAIL_USER,
        to: "a.maximoff.spb@gmail.com",
        subject: "Новая заявка с сайта max-cio.ru",
        text
      });
    })()
  ]);
  return { telegram: results[0].status === "fulfilled", email: results[1].status === "fulfilled" };
}
const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin;
  if (req.method === "OPTIONS") {
    if (!allowed(req)) return sendJson(res, 403, { ok: false }, origin);
    if (origin) res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.writeHead(204); return res.end();
  }
  if (req.url === "/health" && req.method === "GET") return sendJson(res, 200, { ok: true }, origin);
  if (req.url !== "/api/inquiry" || req.method !== "POST") return sendJson(res, 404, { ok: false }, origin);
  if (!allowed(req)) return sendJson(res, 403, { ok: false, error: "origin_not_allowed" }, origin);
  const ip = (req.headers["x-forwarded-for"] || "").split(",")[0].trim() || req.socket.remoteAddress || "unknown";
  if (rateLimited(ip)) return sendJson(res, 429, { ok: false, error: "rate_limited" }, origin);
  try {
    const body = await readBody(req);
    if (body._honey) return sendJson(res, 200, { ok: true }, origin);
    const company = String(body.company || "").trim().slice(0, 120);
    const contact = String(body.contact || "").trim().slice(0, 160);
    const task = String(body.task || "").trim().slice(0, 3000);
    if (!company || !contact || !task) return sendJson(res, 400, { ok: false, error: "missing_fields" }, origin);
    if (company.length < 2 || contact.length < 3 || task.length < 5) return sendJson(res, 400, { ok: false, error: "invalid_fields" }, origin);
    const delivery = await deliver({ company, contact, task });
    if (!delivery.telegram && !delivery.email) {
      console.error("Inquiry delivery failed in all configured channels");
      return sendJson(res, 502, { ok: false, error: "delivery_failed" }, origin);
    }
    if (!delivery.telegram || !delivery.email) console.error("Partial inquiry delivery", delivery);
    return sendJson(res, 200, { ok: true, delivery }, origin);
  } catch (error) {
    console.error("Inquiry request failed:", error.message === "too_large" ? "too_large" : error.message);
    return sendJson(res, error.message === "too_large" ? 413 : 400, { ok: false, error: "request_failed" }, origin);
  }
});
server.listen(PORT, "0.0.0.0", () => console.log("Inquiry API listening on " + PORT));
