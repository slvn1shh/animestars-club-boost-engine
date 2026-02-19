import * as cheerio from "cheerio";

export function extractButton(html: string) {
    const $ = cheerio.load(html);
    const btn = $("button.club__boost__refresh-btn, button.club__boost-btn").first();

    if (!btn.length) return null;

    return {
        cardId: btn.attr("data-card-id"),
        clubId: btn.attr("data-club-id"),
        text: btn.text().trim(),
    };
}

export function extractLoginHash(html: string): string | undefined {
    const match = html.match(/var\s+dle_login_hash\s*=\s*'([^']+)'/);
    return match ? match[1] : undefined;
}

export function extractUserHash(html: string): string | undefined {
    const match = html.match(/var\s+dle_login_hash\s*=\s*'([^']+)'/) || html.match(/user_hash\s*:\s*'([^']+)'/);
    return match ? match[1] : undefined;
}
