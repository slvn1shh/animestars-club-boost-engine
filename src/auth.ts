import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { extractUserHash } from "./parser";

const BASE_URL = "https://animesss.com";
const REQUIRED_COOKIE_NAMES = [
    "server_name_session",
    "PHPSESSID",
    "dle_user_id",
    "dle_password",
    "dle_hash",
    "dle_newpm",
] as const;

const EXPECTED_POST_COOKIE_NAMES = ["PHPSESSID", "dle_user_id", "dle_password", "dle_hash", "dle_newpm"] as const;

const BROWSER_HEADERS = {
    accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
    "accept-language": "en-US,en;q=0.9",
    "cache-control": "no-cache",
    pragma: "no-cache",
    priority: "u=0, i",
    "sec-ch-ua": '"Opera GX";v="127", "Chromium";v="143", "Not A(Brand";v="24"',
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"Windows"',
    "sec-fetch-dest": "document",
    "sec-fetch-mode": "navigate",
    "sec-fetch-site": "none",
    "sec-fetch-user": "?1",
    "upgrade-insecure-requests": "1",
    "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36 OPR/127.0.0.0",
};

function getSetCookieRows(headers: Headers): string[] {
    const headersAny = headers as any;
    if (typeof headersAny.getSetCookie === "function") {
        return headersAny.getSetCookie();
    }

    const single = headers.get("set-cookie");
    if (!single) return [];

    return single
        .split(/,\s*(?=[^;=\s,]+=[^;]*)/g)
        .map((part) => part.trim())
        .filter(Boolean);
}

function saveCookies(headers: Headers, cookies: Map<string, string>) {
    for (const row of getSetCookieRows(headers)) {
        const firstPart = row.split(";")[0]?.trim();
        if (!firstPart) continue;
        const eq = firstPart.indexOf("=");
        if (eq <= 0) continue;
        const key = firstPart.slice(0, eq).trim();
        const value = firstPart.slice(eq + 1).trim();
        if (key) {
            cookies.set(key, value);
        }
    }
}

function readCookieHeader(cookies: Map<string, string>): string {
    return Array.from(cookies.entries())
        .map(([k, v]) => `${k}=${v}`)
        .join("; ");
}

function requireCookies(cookies: Map<string, string>, names: readonly string[], source: string): boolean {
    const missing = names.filter((name) => !cookies.get(name));

    if (missing.length > 0) {
        const got = Array.from(cookies.keys()).sort((a, b) => a.localeCompare(b));
        console.error(`[auth] Missing cookies after ${source}: ${missing.join(", ")}`);
        console.error(`[auth] Captured cookies: ${got.join(", ") || "(none)"}`);
        return false;
    }

    return true;
}

async function upsertEnvValues(updates: Record<string, string>) {
    const envPath = path.join(process.cwd(), ".env");
    const current = await readFile(envPath, "utf8");
    const hasCRLF = current.includes("\r\n");
    const newline = hasCRLF ? "\r\n" : "\n";
    const lines = current.split(/\r?\n/);

    for (const [key, value] of Object.entries(updates)) {
        const formattedValue = value.includes(" ") ? `'${value}'` : value;
        const nextLine = `${key}=${formattedValue}`;
        const idx = lines.findIndex((line) => line.startsWith(`${key}=`));
        if (idx >= 0) {
            lines[idx] = nextLine;
        } else {
            lines.push(nextLine);
        }
    }

    await writeFile(envPath, lines.join(newline), "utf8");
}

export async function login(
    username?: string,
    password?: string
): Promise<{ userHash: string; cookie: string } | null> {
    const resolvedUsername = username || process.env.LOGIN;
    const resolvedPassword = password || process.env.PASSWORD;

    if (!resolvedUsername || !resolvedPassword) {
        console.log(
            "[auth] Missing USERNAME/PASSWORD in .env (or arguments), relying on existing COOKIE and USER_HASH"
        );
        return null;
    }

    console.log(`[auth] Attempting website form login for user: ${resolvedUsername}`);

    const cookies = new Map<string, string>();

    const initialRes = await fetch(`${BASE_URL}/`, {
        method: "GET",
        headers: BROWSER_HEADERS,
        redirect: "manual",
    });
    saveCookies(initialRes.headers, cookies);
    if (initialRes.status !== 200) {
        console.error(`[auth] Failed to load home page. Status=${initialRes.status}`);
        return null;
    }

    const form = new URLSearchParams();
    form.set("login", "submit");
    form.set("login_name", resolvedUsername);
    form.set("login_password", resolvedPassword);

    const postRes = await fetch(`${BASE_URL}/`, {
        method: "POST",
        headers: {
            ...BROWSER_HEADERS,
            cookie: readCookieHeader(cookies),
            "content-type": "application/x-www-form-urlencoded",
            origin: BASE_URL,
            referer: `${BASE_URL}/`,
            "sec-fetch-site": "same-origin",
        },
        body: form.toString(),
        redirect: "manual",
    });
    saveCookies(postRes.headers, cookies);
    if (postRes.status >= 400) {
        console.error(`[auth] Login request failed. Status=${postRes.status}`);
        return null;
    }

    if (!requireCookies(cookies, EXPECTED_POST_COOKIE_NAMES, "POST /")) {
        return null;
    }

    const pageRes = await fetch(`${BASE_URL}/`, {
        method: "GET",
        headers: {
            ...BROWSER_HEADERS,
            cookie: readCookieHeader(cookies),
            referer: `${BASE_URL}/`,
            "sec-fetch-site": "same-origin",
        },
    });
    const html = await pageRes.text();
    saveCookies(pageRes.headers, cookies);

    if (!requireCookies(cookies, REQUIRED_COOKIE_NAMES, "final GET /")) {
        return null;
    }

    const cookieString = REQUIRED_COOKIE_NAMES.map((name) => `${name}=${cookies.get(name)}`).join("; ");

    const userHash = extractUserHash(html);
    if (!userHash) {
        console.error("[auth] Missing USER_HASH after cookie auth");
        return null;
    }

    await upsertEnvValues({
        USER_HASH: userHash,
        COOKIE: cookieString,
    });

    console.log("[auth] Login success. USER_HASH and COOKIE updated in .env");
    return { userHash, cookie: cookieString };
}
