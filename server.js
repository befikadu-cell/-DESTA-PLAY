/*
|--------------------------------------------------------------------------
| AUTH ROUTES (REGISTER / LOGIN)
|--------------------------------------------------------------------------
*/

// First time registration: requires telegramId, phone, and password
async function registerHandler(req, res) {
    try {
        const { telegramId, telegramName, password, phone } = req.body;

        if (!telegramId || String(telegramId).trim() === "") {
            return res.status(400).json({ success: false, error: "Missing Telegram ID" });
        }

        const normalizedPhone = normalizePhone(phone);
        if (!normalizedPhone) {
            return res.status(400).json({ success: false, error: "Phone number is required for registration" });
        }

        if (!validPassword(password)) {
            return res.status(400).json({ success: false, error: "Password must be between 8 and 128 characters" });
        }

        const existingByTelegram = await findPlayerByTelegramId(telegramId);
        if (existingByTelegram) {
            return res.status(400).json({ success: false, error: "Account already exists. Please login." });
        }

        const existingByPhone = await findPlayerByPhone(normalizedPhone);
        if (existingByPhone) {
            return res.status(400).json({ success: false, error: "Phone number already registered to another account." });
        }

        const passwordHash = await argon2.hash(password);
        const playerId = makePlayerId();
        const safeName = normalizeTelegramName(telegramName);

        const { data: insertedPlayer, error } = await supabase
            .from("players")
            .insert({
                id: playerId,
                telegram_id: String(telegramId),
                phone: normalizedPhone,
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


// Subsequent logins: uses the automatically passed telegramId and asks ONLY for password
async function loginHandler(req, res) {
    try {
        const { telegramId, phone, password } = req.body;

        if (!password) {
            return res.status(400).json({ success: false, error: "Please enter your password" });
        }

        let player = null;

        // Auto-lookup by Telegram ID if passed automatically from the Telegram WebApp context
        if (telegramId) {
            player = await findPlayerByTelegramId(telegramId);
        } else if (phone) {
            // Fallback lookup via phone number if telegramId is not provided
            player = await findPlayerByPhone(phone);
        }

        if (!player) {
            return res.status(404).json({ success: false, error: "Account not found. Please register first." });
        }

        if (!player.password_hash) {
            return res.status(401).json({ success: false, error: "Invalid password configuration. Contact support." });
        }

        // Verify password against Argon2 hash
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
