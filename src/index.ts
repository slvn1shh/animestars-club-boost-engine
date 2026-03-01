// src/index.ts
import { client } from "./httpClient";
import { extractButton } from "./parser";
import { DateTime } from "luxon";
import { login } from "./auth";

const CLUB_ID = process.env.CLUB_ID || "52";

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

let USER_HASH = normalizeEnvValue(process.env.USER_HASH); // required or via login
let COOKIE = normalizeEnvValue(process.env.COOKIE); // full cookie string for session or via login
const USERNAME = normalizeEnvValue(process.env.LOGIN);
const PASSWORD = normalizeEnvValue(process.env.PASSWORD);

const START_HOUR = 21; // 21:01 in UTC+3
const START_MINUTE = 1;
const START_SECOND = 2; // offset to allow 600 boost_count skipping
const START_GRACE_MINUTES = 10;
const START_ZONE = "UTC+3";

function msUntilNextStartUtcPlus3(): number {
    const now = DateTime.now().setZone(START_ZONE);
    let target = now.set({ hour: START_HOUR, minute: START_MINUTE, second: START_SECOND, millisecond: 0 });
    if (now >= target) {
        target = target.plus({ days: 1 });
    }
    return target.toMillis() - now.toMillis();
}

function canStartNowInManualGraceWindowUtcPlus3(): boolean {
    const now = DateTime.now().setZone(START_ZONE);
    const todayStart = now.set({ hour: START_HOUR, minute: START_MINUTE, second: START_SECOND, millisecond: 0 });
    const graceEnd = todayStart.plus({ minutes: START_GRACE_MINUTES });
    return now >= todayStart && now <= graceEnd;
}

async function sleep(ms: number) {
    return new Promise((r) => setTimeout(r, ms));
}

function ts(): number {
    return Date.now();
}

async function fetchInitialCard(): Promise<{ cardId: string; clubId: string } | null> {
    console.log(`[info] Fetching initial page...`);
    const url = `/clubs/boost/?id=${CLUB_ID}`;
    const res = await client.get(url, {
        headers: {
            accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
            referer: `https://animesss.com/clubs/${CLUB_ID}/`,
            cookie: COOKIE || undefined,
            "cache-control": "no-cache",
            pragma: "no-cache",
            "upgrade-insecure-requests": "1",
        },
    });

    if (res.status !== 200 || typeof res.data !== "string") {
        console.warn("Unexpected initial page response", res.status);
        return null;
    }
    const btn = extractButton(res.data);
    if (!btn?.cardId || !btn?.clubId) return null;
    return { cardId: btn.cardId, clubId: btn.clubId };
}

interface RefreshResponse {
    boost_html?: string;
    boost_no?: string;
    error?: string;
    id?: string;
    clicks?: number;
    debug?: string[];
    boost_count?: string;
}

interface ActionResponse {
    error?: string;
    boost_html_reloaded?: string;
    boost_html_changed?: string;
    boost_count?: string;
}

function parseBoostCount(v: string | undefined): number | null {
    if (!v) return null;
    return parseInt(v, 10);
}

async function refreshCard(cardId: string): Promise<{
    nextCardId?: string;
    donateReady: boolean;
    boostCount: number | null;
    reason?: string;
}> {
    console.log(`[info] Refreshing card...`);
    const url = `/club_refresh/?action=boost_refresh&card_id=${cardId}&user_hash=${USER_HASH}&_=${ts()}`;
    const res = await client.get<RefreshResponse>(url, {
        headers: {
            accept: "application/json, text/javascript, */*; q=0.01",
            referer: `https://animesss.com/clubs/boost/?id=${CLUB_ID}`,
            "x-requested-with": "XMLHttpRequest",
            cookie: COOKIE || undefined,
        },
    });
    let data: RefreshResponse | null = null;
    try {
        data = typeof res.data === "string" ? JSON.parse(res.data) : res.data;
    } catch (_) {
        // console.log("Failed to parse refresh response:", res.data);
        return { donateReady: false, boostCount: null, reason: "parse_error" };
    }

    if (data?.error === "Too many requests") {
        return { donateReady: false, boostCount: parseBoostCount(data.boost_count), reason: "rate_limited" };
    }

    const html = data?.boost_html;
    const btn = html ? extractButton(html) : null;
    const donateReady = btn?.text === "Пожертвовать карту" || !!data?.boost_no;
    const nextCardId = btn?.cardId || cardId;
    const boostCount = parseBoostCount(data?.boost_count);
    return { nextCardId, donateReady, boostCount, reason: "donate_ready" };
}

async function donateCard(cardId: string): Promise<{
    nextCardId?: string;
    boostCount: number | null;
    outcome: "success" | "blocked" | "no_card" | "rate_limited";
}> {
    console.log(`[info] Donating card...`);
    const url = `/club_actions/?action=boost&card_id=${cardId}&skip=0&user_hash=${USER_HASH}&_=${ts()}`;
    const res = await client.get<ActionResponse>(url, {
        headers: {
            accept: "application/json, text/javascript, */*; q=0.01",
            referer: `https://animesss.com/clubs/boost/?id=${CLUB_ID}`,
            "x-requested-with": "XMLHttpRequest",
            cookie: COOKIE || undefined,
        },
    });
    const data: ActionResponse = typeof res.data === "string" ? JSON.parse(res.data) : res.data;

    if (data?.error === "Too many requests") {
        return { boostCount: parseBoostCount(data.boost_count), outcome: "rate_limited" };
    }
    const blocked = data?.error?.includes("заблокирована");
    const noCurrentCard = data?.error?.includes("нет карты");

    const html = data?.boost_html_reloaded || data?.boost_html_changed;
    const btn = html ? extractButton(html) : null;
    const nextCardId = btn?.cardId;
    const boostCount = parseBoostCount(data?.boost_count);

    return { nextCardId, boostCount, outcome: blocked ? "blocked" : noCurrentCard ? "no_card" : "success" };
}

async function runOnceCycle() {
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

    // 1) Fetch initial card
    let initial = await fetchInitialCard();
    while (!initial) {
        console.log("Retry initial page fetch in 2s...");
        await sleep(2000);
        initial = await fetchInitialCard();
    }

    let currentCardId = initial.cardId;
    console.log(`[init] cardId=${currentCardId} clubId=${initial.clubId}`);

    // 2) Loop until boost_count reaches 600
    while (true) {
        // Refresh until donate button appears
        let donateReady = false;
        let boostCount: number | null = null;
        let foundZeroOnce = false;
        let sleepMs = 111;

        while (!donateReady) {
            const r = await refreshCard(currentCardId);
            boostCount = r.boostCount;

            if (boostCount !== null && foundZeroOnce) {
                console.log(`[refresh] boost_count=${boostCount}; reason=${r.reason}`);
                if (boostCount >= 600) {
                    console.log("Reached boost_count >= 600. Stopping.");
                    return;
                }
            }

            if (boostCount && boostCount < 599) foundZeroOnce = true;

            if (r.nextCardId) currentCardId = r.nextCardId;

            if (r.donateReady) {
                donateReady = true;
                break;
            }
            if (r.reason === "rate_limited") {
                const ms = Math.floor(Math.random() * 111) + sleepMs;
                console.log(`[refresh] rate limited, retrying in ${ms}ms`);
                await sleep(ms);
                continue;
            }
            if (r.reason === "parse_error") {
                console.log(`[refresh] parse error, retrying in 10.5s`);
                await sleep(10777 + Math.random() * 10.111);
                continue;
            }

            // rate-limited or not ready yet; sleep a bit
            // human-like randomization: occasionally wait much longer
            sleepMs += 111;
            await sleep(sleepMs);
        }

        // 3) Donate step
        while (true) {
            const a = await donateCard(currentCardId);
            if (a.boostCount !== null) {
                const outcomeText =
                    a.outcome === "blocked"
                        ? "card is blocked"
                        : a.outcome === "no_card"
                          ? "you don't own needed card"
                          : a.outcome === "success"
                            ? "success"
                            : "rate_limited";
                console.log(`[donate] boost_count=${a.boostCount} outcome=${outcomeText}`);
                if (a.boostCount >= 600) {
                    console.log("Reached boost_count >= 600. Stopping.");
                    return;
                }
            }

            if (a.outcome === "rate_limited") {
                await sleep(500 + Math.random() * 1000);
                continue;
            }

            if (a.nextCardId) {
                currentCardId = a.nextCardId;
                continue;
            }

            // If no nextCardId, try to re-fetch initial page to recover
            const fallback = await fetchInitialCard();
            if (fallback?.cardId) {
                currentCardId = fallback.cardId;
                break;
            }

            // As last resort wait and retry donate
            await sleep(333);
        }
    }
}

async function main() {
    let isFirstLoop = true;

    while (true) {
        let waitMs = msUntilNextStartUtcPlus3();

        if ((isFirstLoop && canStartNowInManualGraceWindowUtcPlus3()) || !!process.env.NO_WAIT) {
            waitMs = 0;
        }

        if (waitMs > 0) {
            const secs = Math.round(waitMs / 600);
            console.log(`Waiting ${secs} sec until 21:01 (UTC+3) start...`);
            await sleep(waitMs);
        }

        console.log("Starting daily cycle...");
        try {
            await runOnceCycle();
        } catch (e) {
            console.error("Cycle error:", e);
        }

        isFirstLoop = false;

        // After finishing (reaching 600), schedule next day
        const toNext = msUntilNextStartUtcPlus3();
        console.log(`Cycle finished. Next start in ${Math.round(toNext / 60000)} min.`);
        await sleep(toNext);
    }
}

main();
