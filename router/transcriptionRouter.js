const express = require("express");
const router = express.Router();
const fs = require("fs");
const axios = require("axios");
const path = require("path");
const multer = require("multer");
const Transcription = require("../models/Transcription");
const { default: OpenAI } = require("openai");
require("dotenv").config();

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const ASSEMBLY_API_KEY = process.env.ASSEMBLY_API_KEY;

// Ensure uploads folder exists
const uploadDir = path.join(__dirname, "..", "uploads");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  },
});

const upload = multer({ storage });

router.post("/transcribe", upload.single("audio"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "No audio file uploaded" });
  }

  try {
    // Read the audio file as a binary buffer
    const audioData = fs.readFileSync(req.file.path);

    // Upload audio to AssemblyAI first
    const uploadResponse = await axios.post(
      "https://api.assemblyai.com/v2/upload",
      audioData,
      {
        headers: {
          authorization: ASSEMBLY_API_KEY,
          "content-type": "application/octet-stream",
        },
      }
    );

    const audioUrl = uploadResponse.data.upload_url;

    // Create transcription
    const transcriptionResponse = await axios.post(
      "https://api.assemblyai.com/v2/transcript",
      {
        audio_url: audioUrl,
        // language_code: "en", // optional
      },
      {
        headers: {
          authorization: ASSEMBLY_API_KEY,
          "content-type": "application/json",
        },
      }
    );

    const transcriptId = transcriptionResponse.data.id;

    // Polling for transcript completion
    let completed = false;
    let transcriptText = "";
    while (!completed) {
      const pollResponse = await axios.get(
        `https://api.assemblyai.com/v2/transcript/${transcriptId}`,
        {
          headers: {
            authorization: ASSEMBLY_API_KEY,
          },
        }
      );

      if (pollResponse.data.status === "completed") {
        transcriptText = pollResponse.data.text;
        completed = true;
      } else if (pollResponse.data.status === "failed") {
        throw new Error("AssemblyAI transcription failed");
      } else {
        // Wait 1 second before next poll
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }

    // Clean up uploaded file
    fs.unlinkSync(req.file.path);

    return res.json({ text: transcriptText });
  } catch (err) {
    console.error("Error transcribing:", err.message || err);

    if (req.file?.path && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }

    return res.status(500).json({
      error: err.message || "Transcription failed",
    });
  }
});

router.get("/records", async (req, res) => {
  try {
    const { category } = req.query;

    // Validate category if provided
    if (category && !["live", "audio"].includes(category)) {
      return res.status(400).json({
        error: "Invalid category. Must be 'live' or 'audio'.",
      });
    }

    const filter = category ? { category } : {};

    const transcriptions = await Transcription.find(filter).sort({
      createdAt: -1,
    });

    res.status(200).json({
      count: transcriptions.length,
      transcriptions,
    });
  } catch (err) {
    console.error("Error fetching transcriptions:", err);
    res
      .status(500)
      .json({ error: "Server error while fetching transcriptions" });
  }
});

router.get("/getSingleTranscript", async (req, res) => {
  try {
    const { id } = req.query;

    // Validate ID
    if (!id) {
      return res.status(400).json({ error: "Transcript ID is required." });
    }

    // Fetch single transcript by ID
    const transcript = await Transcription.findById(id);

    if (!transcript) {
      return res.status(404).json({ error: "Transcript not found." });
    }

    // Success
    res.status(200).json({ transcript });
  } catch (err) {
    console.error("Error fetching single transcript:", err);
    res
      .status(500)
      .json({ error: "Server error while fetching the transcript." });
  }
});

router.post("/tts", async (req, res) => {
  try {
    const { text, voice = "coral", format = "mp3" } = req.body;

    if (!text || text.trim().length === 0) {
      return res.status(400).json({ error: "Text is required" });
    }

    const response = await openai.audio.speech.create({
      model: "gpt-4o-mini-tts",
      voice,
      input: text,
      response_format: format,
    });

    // Convert to buffer
    const buffer = Buffer.from(await response.arrayBuffer());

    // Set headers to make browser play audio
    res.set({
      "Content-Type": `audio/${format}`,
      "Content-Length": buffer.length,
      "Content-Disposition": `inline; filename="speech.${format}"`,
    });

    // Send the audio directly
    return res.send(buffer);
  } catch (error) {
    console.error("TTS Error:", error.message || error);
    return res.status(500).json({ error: "Text-to-speech failed" });
  }
});

module.exports = router;
