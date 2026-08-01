const express = require("express");
const { fetchAninekoWatchStreams } = require("../services/anineko");

const router = express.Router();

router.get("/mal/:malId/:episode", async (req, res, next) => {
  const malId = Number(req.params.malId);
  const episode = Number(req.params.episode);

  if (!Number.isFinite(malId) || malId <= 0) {
    return res.status(400).json({ success: false, message: "Invalid malId" });
  }
  if (!Number.isFinite(episode) || episode <= 0) {
    return res
      .status(400)
      .json({ success: false, message: "Invalid episode number" });
  }

  try {
    const data = await fetchAninekoWatchStreams(malId, episode);
    return res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
