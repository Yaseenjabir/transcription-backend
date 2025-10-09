const express = require("express");
const router = express.Router();
const Transcription = require("../models/Transcription");

router.post("/saveText", async (req, res) => {
  try {
    const { text, category } = req.body;

    if (!text || !category) {
      return res.status(400).json({ error: "Text and category are required." });
    }

    if (!["live", "audio"].includes(category)) {
      return res
        .status(400)
        .json({ error: "Invalid category. Must be 'live' or 'audio'." });
    }

    const transcription = new Transcription({ text, category });
    await transcription.save();

    res.status(201).json({
      message: "Transcription saved successfully",
      transcription,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error while saving transcription" });
  }
});

module.exports = router;
