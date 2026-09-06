import crypto from "crypto";
import fs from "fs/promises";
import path from "path";

export function createVoiceRouter(app, options = {}) {
  const publicDir = options.publicDir || path.join(process.cwd(), "public");
  const cacheDir = path.join(publicDir, "voice-cache");

  const MAX_TEXT_LENGTH = 180;

  function cleanText(value) {
    return String(value || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, MAX_TEXT_LENGTH);
  }

  function cleanLanguage(value) {
    // Use English TTS for reliable game announcements.
    // Amharic is intentionally mapped to English for this version.
    return String(value || "").toLowerCase() === "am" ? "en" : "en";
  }

  function makeCacheFile(lang, text) {
    const hash = crypto
      .createHash("sha256")
      .update(`${lang}:${text}`)
      .digest("hex");

    return path.join(cacheDir, `${hash}.mp3`);
  }

  async function getGoogleVoice(lang, text) {
    const url =
      "https://translate.google.com/translate_tts" +
      "?ie=UTF-8" +
      "&q=" +
      encodeURIComponent(text) +
      "&tl=" +
      encodeURIComponent(lang) +
      "&client=tw-ob";

    const response = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36",
        Accept: "audio/mpeg,audio/*;q=0.9,*/*;q=0.8",
      },
    });

    if (!response.ok) {
      throw new Error(`Google TTS returned HTTP ${response.status}`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());

    if (!buffer.length) {
      throw new Error("Google TTS returned empty audio");
    }

    return buffer;
  }

  app.get("/api/voice/health", async (req, res) => {
    res.json({
      ok: true,
      service: "server-voice",
      provider: "google-tts",
      cache: true,
    });
  });

  app.get("/api/voice", async (req, res) => {
    try {
      const text = cleanText(req.query.text);
      const lang = cleanLanguage(req.query.lang);

      if (!text) {
        return res.status(400).json({
          ok: false,
          error: "Voice text is required",
        });
      }

      await fs.mkdir(cacheDir, { recursive: true });

      const cacheFile = makeCacheFile(lang, text);

      // Serve cached MP3 when available.
      try {
        const cached = await fs.readFile(cacheFile);

        res.setHeader("Content-Type", "audio/mpeg");
        res.setHeader("Content-Length", cached.length);
        res.setHeader(
          "Cache-Control",
          "public, max-age=604800, immutable"
        );

        return res.send(cached);
      } catch (cacheError) {
        // Cache miss — generate the audio below.
      }

      const audioBuffer = await getGoogleVoice(lang, text);

      await fs.writeFile(cacheFile, audioBuffer);

      res.setHeader("Content-Type", "audio/mpeg");
      res.setHeader("Content-Length", audioBuffer.length);
      res.setHeader(
        "Cache-Control",
        "public, max-age=604800, immutable"
      );

      return res.send(audioBuffer);
    } catch (error) {
      console.error("VOICE ERROR:", error);

      return res.status(503).json({
        ok: false,
        error: "Voice service unavailable",
      });
    }
  });
}
