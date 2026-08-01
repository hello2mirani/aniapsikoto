const express = require("express");
const cors = require("cors");
const aninekoRoutes = require("./routes/anineko");
const anikotoRoutes = require("./routes/anikoto");

const app = express();

app.use(cors());
app.use(express.json());

app.get("/", (_req, res) => {
  res.json({
    service: "aniapikoto",
    version: "1.0.0",
    endpoints: {
      aninekoWatch: "GET /api/anineko/mal/:malId/:episode",
      anikotoWatch: "GET /api/anikoto/mal/:malId/:episode",
    },
  });
});

app.use("/api/anineko", aninekoRoutes);
app.use("/api/anikoto", anikotoRoutes);

app.use((_req, res) => {
  res.status(404).json({ success: false, message: "Not found" });
});

app.use((error, _req, res, _next) => {
  const status = error.status || 500;
  const message = error.message || "Internal server error";
  res.status(status).json({ success: false, message });
});

module.exports = app;
