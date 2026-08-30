const express = require("express");
const cors = require("cors");

const app = express();

app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 10000;

app.get("/", (req, res) => {
    res.json({
        success: true,
        app: "DESTA PLAY",
        status: "Backend is running"
    });
});

app.get("/api/status", (req, res) => {
    res.json({
        success: true,
        status: "online",
        time: new Date().toISOString()
    });
});

app.listen(PORT, "0.0.0.0", () => {
    console.log(`DESTA PLAY backend running on port ${PORT}`);
});
