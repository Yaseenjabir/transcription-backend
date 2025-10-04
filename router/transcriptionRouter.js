const express = require("express");
const router = express.Router();
const fs = require("fs");
const axios = require("axios");
const path = require("path");
const multer = require("multer");
const FormData = require("form-data"); // ✅ import form-data
require("dotenv").config();
// console.log(process.env.OPENAI_API_KEY);

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

const upload = multer({ storage: storage });

// OpenAI API Key
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

router.post("/transcribe", upload.single("audio"), async (req, res) => {
  console.log("Key is : ", OPENAI_API_KEY);
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No audio file uploaded" });
    }

    // Create form data for Whisper API
    const formData = new FormData();
    formData.append("file", fs.createReadStream(req.file.path));
    formData.append("model", "whisper-1");
    formData.append("language", "en"); // Optional
    formData.append("response_format", "json"); // json, text, srt, vtt, etc.

    // Call OpenAI Whisper API
    const response = await axios.post(
      "https://api.openai.com/v1/audio/transcriptions",
      formData,
      {
        headers: {
          ...formData.getHeaders(),
          Authorization: `Bearer ${OPENAI_API_KEY}`,
        },
      }
    );

    // Clean up uploaded file
    fs.unlinkSync(req.file.path);

    // Return transcription
    return res.json({
      text: response.data.text,
      ...(response.data.duration && { duration: response.data.duration }),
      ...(response.data.language && { language: response.data.language }),
    });
  } catch (err) {
    console.error("Error transcribing:", err.response?.data || err.message);

    if (req.file?.path && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }

    return res.status(500).json({
      error: err.response?.data?.error?.message || "Transcription failed",
    });
  }
});

module.exports = router;
