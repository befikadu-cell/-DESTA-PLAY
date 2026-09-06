/*
 * DESTA PLAY — SERVER VOICE LAYER
 *
 * Real audio voice endpoint for Telegram Mini App clients.
 * The game engines are NOT modified.
 *
 * Flow:
 *   game state -> frontend announcement -> /api/voice -> cached MP3 -> <audio>
 *
 * The server requests a short speech clip from Google Translate's public
 * speech endpoint and caches the returned MP3 locally. No API key is required.
 */

import crypto from "crypto";
import fs from "fs/promises";
import path from "path";

const MAX_TEXT_LENGTH = 180;
const CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function cleanText(value) {
    return String(value || "")
        .replace(/[\r\n]+/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, MAX_TEXT_LENGTH);
}

function safeLanguage(value) {
    const lang = String(value || "en").trim().toLowerCase();
    /* Google Translate speech does not provide a dependable Amharic voice
       for this application, so Amharic UI currently uses English game-call
       audio rather than becoming silent. */
    return lang === "am" ? "en" : "en";
}

function cacheKey(lang, text) {
    return crypto
        .createHash("sha256")
        .update(`${lang}|${text}`)
        .digest("hex");
}

async function fetchSpeechMp3(text, lang) {
    const params = new URLSearchParams({
        ie: "UTF-8",
        q: text,
        tl: lang,
        client: "tw-ob"
    });

    const url = `https://translate.google.com/translate_tts?${params.toString()}`;
    const response = await fetch(url, {
        headers: {
            "User-Agent": "Mozilla/5.0",
            "Accept": "audio/mpeg,audio/*;q=0.9,*/*;q=0.8"
        }
    });

    if (!response.ok) {
        throw new Error(`TTS provider returned HTTP ${response.status}`);
    }

    const contentType = String(response.headers.get("content-type") || "").toLowerCase();
    if (contentType && !contentType.includes("audio") && !contentType.includes("mpeg")) {
        throw new Error("TTS provider did not return audio");
    }

    const data = Buffer.from(await response.arrayBuffer());
    if (data.length < 1000) {
        throw new Error("TTS provider returned an empty audio response");
    }

    return data;
}

export function createVoiceRouter(app, options = {}) {
    const publicDir = options.publicDir || path.join(process.cwd(), "public");
    const cacheDir = path.join(publicDir, "voice-cache");

    app.get("/api/voice", async (req, res) => {
        const text = cleanText(req.query.text);
        const lang = safeLanguage(req.query.lang);

        if (!text) {
            return res.status(400).json({
                success: false,
                error: "Voice text is required"
            });
        }

        try {
            await fs.mkdir(cacheDir, { recursive: true });

            const key = cacheKey(lang, text);
            const filename = `${key}.mp3`;
            const filePath = path.join(cacheDir, filename);

            try {
                const stat = await fs.stat(filePath);
                if (Date.now() - stat.mtimeMs < CACHE_MAX_AGE_MS && stat.size > 1000) {
                    res.setHeader("Content-Type", "audio/mpeg");
                    res.setHeader("Cache-Control", "public, max-age=604800");
                    return res.sendFile(filePath);
                }
            } catch (_) {
                /* Cache miss. */
            }

            const audio = await fetchSpeechMp3(text, lang);
            await fs.writeFile(filePath, audio);

            res.setHeader("Content-Type", "audio/mpeg");
            res.setHeader("Cache-Control", "public, max-age=604800");
            return res.sendFile(filePath);
        } catch (error) {
            console.error("[VOICE] Audio generation failed:", error.message);
            return res.status(503).json({
                success: false,
                error: "Voice audio is temporarily unavailable"
            });
        }
    });

    app.get("/api/voice/health", async (_req, res) => {
        try {
            await fs.mkdir(cacheDir, { recursive: true });
            return res.json({
                success: true,
                voice: "server-audio",
                cache: "enabled"
            });
        } catch (error) {
            return res.status(500).json({
                success: false,
                error: error.message
            });
        }
    });
}
