import { client } from "./httpClient";
import { extractLoginHash, extractUserHash } from "./parser";
import { URLSearchParams } from "url";

export async function login(username?: string, password?: string): Promise<{ userHash: string | null } | null> {
    if (!username || !password) {
        console.log("[auth] No credentials provided, relying on .env COOKIE and USER_HASH");
        return null;
    }

    console.log(`[auth] Attempting login for user: ${username}`);

    // 1. Get initial page to get cookies and login hash
    const initialRes = await client.get("/");
    const loginHash = extractLoginHash(initialRes.data);

    if (!loginHash) {
        console.warn("[auth] Could not find login hash on home page");
    }

    // 2. Perform login
    const params = new URLSearchParams();
    params.append("login", "submit");
    params.append("login_name", username);
    params.append("login_password", password);
    params.append("login_not_save", "1");
    if (loginHash) {
        params.append("user_hash", loginHash);
    }

    const loginRes = await client.post("/", params, {
        headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            referer: "https://animesss.com/",
        },
    });

    if (loginRes.status !== 200) {
        console.error(`[auth] Login request failed with status ${loginRes.status}`);
        return null;
    }

    // 3. Extract user hash from the response or subsequent page
    // Often DLE redirects or stays on same page with user info
    let userHash = extractUserHash(loginRes.data);

    if (!userHash) {
        // Try fetching a page where user_hash is definitely present, e.g., the boost page
        const boostPage = await client.get("/clubs/boost/?id=52");
        userHash = extractUserHash(boostPage.data);
    }

    if (userHash) {
        console.log(`[auth] Successfully logged in. User Hash: ${userHash}`);
        return { userHash };
    } else {
        console.error("[auth] Login might have failed or could not extract USER_HASH");
        return null;
    }
}
