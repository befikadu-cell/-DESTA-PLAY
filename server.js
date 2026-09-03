/*
|--------------------------------------------------------------------------
| AUTH ROUTES (REGISTER / LOGIN)
|--------------------------------------------------------------------------
*/

// Registration: Requires ONLY telegramId and password (no phone or extra account info required)
async function registerHandler(req, res) {
    try {
        const { telegramId, telegramName, password } = req.body;

        if (!telegramId || String(telegramId).trim() === "") {
            return res.status(400).json({ success: false, error: "Missing Telegram ID" });
        }

        if (!validPassword(password)) {
            return res.status(400).json({ success: false, error: "Password must be between 8 and 128 characters" });
        }

        // Check if player is already registered
        const existingByTelegram = await findPlayerByTelegramId(telegramId);
        if (existingByTelegram) {
            return res.status(400).json({ success: false, error: "Account already exists. Please enter your password to log in." });
        }

        const passwordHash = await argon2.hash(password);
        const playerId = makePlayerId();
        const safeName = normalizeTelegramName(telegramName);

        // Insert new player with NULL phone (no account/phone details required on sign up)
        const { data: insertedPlayer, error } = await supabase
            .from("players")
            .insert({
                id: playerId,
                telegram_id: String(telegramId),
                phone: null,
                username: safeName,
                password_hash: passwordHash,
                balance: 0,
                created_at: nowIso(),
                updated_at: nowIso()
            })
            .select("*")
            .single();

        if (error) {
            await dbError("Register insert", error);
            return res.status(500).json({ success: false, error: "Failed to create player account" });
        }

        const token = createSession(insertedPlayer);
        return res.json({
            success: true,
            token,
            player: publicPlayer(insertedPlayer)
        });
    } catch (error) {
        console.error("Registration error:", error);
        return res.status(500).json({ success: false, error: error.message || "Registration failed" });
    }
}

app.post("/api/auth/register", registerHandler);
app.post("/api/account/register", registerHandler);


// Subsequent logins: Detects telegramId automatically and requires ONLY password
async function loginHandler(req, res) {
    try {
        const { telegramId, password } = req.body;

        if (!telegramId) {
            return res.status(400).json({ success: false, error: "Missing Telegram ID" });
        }

        if (!password) {
            return res.status(400).json({ success: false, error: "Please enter your password" });
        }

        // Auto-lookup by Telegram ID
        const player = await findPlayerByTelegramId(telegramId);

        if (!player) {
            return res.status(404).json({ success: false, error: "Account not found. Please register first." });
        }

        if (!player.password_hash) {
            return res.status(401).json({ success: false, error: "Invalid password configuration. Contact support." });
        }

        // Verify password
        const valid = await argon2.verify(player.password_hash, password);
        if (!valid) {
            return res.status(401).json({ success: false, error: "Incorrect password" });
        }

        const token = createSession(player);
        return res.json({
            success: true,
            token,
            player: publicPlayer(player)
        });
    } catch (error) {
        console.error("Login error:", error);
        return res.status(500).json({ success: false, error: error.message || "Login failed" });
    }
}

app.post("/api/auth/login", loginHandler);
app.post("/api/account/login", loginHandler);
