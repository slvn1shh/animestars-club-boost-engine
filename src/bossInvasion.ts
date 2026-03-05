import * as cheerio from "cheerio";
import { client } from "./httpClient";
import { login } from "./auth";

function normalizeEnvValue(value?: string): string {
    const raw = (value || "").trim();
    if (!raw) return "";
    if ((raw.startsWith("'") && raw.endsWith("'")) || (raw.startsWith('"') && raw.endsWith('"'))) {
        return raw.slice(1, -1).trim();
    }
    return raw;
}

function isPlaceholderValue(value: string): boolean {
    if (!value) return true;
    const lower = value.toLowerCase();
    return (
        lower.includes("placeholder") ||
        lower.includes("your_") ||
        lower.includes("changeme") ||
        lower.includes("example")
    );
}

function sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function withLeadingSlash(path: string): string {
    if (!path) return "/boss_invasion";
    if (path.startsWith("http://") || path.startsWith("https://")) {
        try {
            const parsed = new URL(path);
            return `${parsed.pathname}${parsed.search}`;
        } catch {
            return "/boss_invasion";
        }
    }
    return path.startsWith("/") ? path : `/${path}`;
}

let USER_HASH = normalizeEnvValue(process.env.USER_HASH);
let COOKIE = normalizeEnvValue(process.env.COOKIE);
const USERNAME = normalizeEnvValue(process.env.LOGIN);
const PASSWORD = normalizeEnvValue(process.env.PASSWORD);

interface BossAction {
    method: "GET" | "POST";
    url: string;
    payload: URLSearchParams;
}

interface ActionResult {
    outcome: "success" | "rate_limited" | "no_action" | "error";
    html?: string;
    reason?: string;
}

function findBossAction(html: string): BossAction | null {
    const $ = cheerio.load(html);
    const form = $("form").has("button").first();
    const button = form.find("button").first();

    if (!button.length || !form.length) {
        return null;
    }

    const payload = new URLSearchParams();
    form.find("input,select,textarea").each((_, el) => {
        const field = $(el);
        const name = field.attr("name");
        if (!name) return;

        const tag = (field.get(0)?.tagName || "").toLowerCase();
        if (tag === "select") {
            const selected = field.find("option[selected]").first().attr("value") ?? field.find("option").first().attr("value");
            payload.set(name, selected ?? "");
            return;
        }

        const type = (field.attr("type") || "").toLowerCase();
        if ((type === "checkbox" || type === "radio") && !field.is(":checked")) {
            return;
        }

        payload.set(name, field.val()?.toString() ?? "");
    });

    const buttonName = button.attr("name");
    if (buttonName) {
        payload.set(buttonName, button.attr("value") ?? "1");
    }

    const formMethod = (button.attr("formmethod") || form.attr("method") || "GET").toUpperCase();
    const formAction = button.attr("formaction") || form.attr("action") || "/boss_invasion";

    return {
        method: formMethod === "POST" ? "POST" : "GET",
        url: withLeadingSlash(formAction),
        payload,
    };
}

async function fetchBossPage(): Promise<string | null> {
    const res = await client.get("/boss_invasion", {
        headers: {
            accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            referer: "https://animesss.com/",
            cookie: COOKIE || undefined,
            "cache-control": "no-cache",
            pragma: "no-cache",
        },
    });

    if (res.status !== 200 || typeof res.data !== "string") {
        return null;
    }
    return res.data;
}

async function submitBossAction(action: BossAction): Promise<ActionResult> {
    try {
        if (action.method === "POST") {
            const res = await client.post(action.url, action.payload.toString(), {
                headers: {
                    accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                    "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
                    referer: "https://animesss.com/boss_invasion",
                    cookie: COOKIE || undefined,
                    "x-requested-with": "XMLHttpRequest",
                },
            });
            const body = typeof res.data === "string" ? res.data : JSON.stringify(res.data);
            if (res.status === 429 || body.toLowerCase().includes("too many requests")) {
                return { outcome: "rate_limited", html: body, reason: "too_many_requests" };
            }
            return { outcome: "success", html: body };
        }

        const query = action.payload.toString();
        const url = query ? `${action.url}${action.url.includes("?") ? "&" : "?"}${query}` : action.url;
        const res = await client.get(url, {
            headers: {
                accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                referer: "https://animesss.com/boss_invasion",
                cookie: COOKIE || undefined,
                "x-requested-with": "XMLHttpRequest",
            },
        });
        const body = typeof res.data === "string" ? res.data : JSON.stringify(res.data);
        if (res.status === 429 || body.toLowerCase().includes("too many requests")) {
            return { outcome: "rate_limited", html: body, reason: "too_many_requests" };
        }
        return { outcome: "success", html: body };
    } catch (err) {
        return { outcome: "error", reason: String(err) };
    }
}

async function main() {
    if (USERNAME && PASSWORD) {
        const auth = await login(USERNAME, PASSWORD);
        if (auth) {
            USER_HASH = auth.userHash;
            COOKIE = auth.cookie;
        }
    }

    const hasManualHash = !!USER_HASH && !isPlaceholderValue(USER_HASH);
    const hasManualCookie = !!COOKIE && !isPlaceholderValue(COOKIE);
    if (!hasManualHash && !hasManualCookie) {
        console.error("USER_HASH and COOKIE are missing (or still placeholder values).");
        return;
    }

    let failStreak = 0;

    while (true) {
        const pageHtml = await fetchBossPage();
        if (!pageHtml) {
            failStreak++;
            const delay = Math.min(5000, 500 + failStreak * 500);
            console.log(`[boss] Failed to load /boss_invasion, retry in ${delay}ms`);
            await sleep(delay);
            continue;
        }

        const action = findBossAction(pageHtml);
        if (!action) {
            console.log("[boss] No action button found. Retrying in 15s.");
            await sleep(15000);
            continue;
        }

        const result = await submitBossAction(action);
        if (result.outcome === "rate_limited") {
            const delay = 750 + Math.floor(Math.random() * 1250);
            console.log(`[boss] Rate limited. Retry in ${delay}ms`);
            await sleep(delay);
            continue;
        }

        if (result.outcome === "error") {
            failStreak++;
            const delay = Math.min(10000, 1000 + failStreak * 1000);
            console.log(`[boss] Action error (${result.reason}). Retry in ${delay}ms`);
            await sleep(delay);
            continue;
        }

        failStreak = 0;
        console.log("[boss] Click action sent.");

        if (result.html) {
            const nextAction = findBossAction(result.html);
            if (!nextAction) {
                console.log("[boss] Action button disappeared. Polling in 20s.");
                await sleep(20000);
                continue;
            }
        }

        await sleep(250 + Math.floor(Math.random() * 250));
    }
}

main();
