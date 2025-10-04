// assembly.js
const express = require("express");
const fs = require("fs");
const FormData = require("form-data");
const axios = require("axios");
const cors = require("cors");
const { WebSocketServer } = require("ws");
const http = require("http");
const transcriptionRouter = require("./router/transcriptionRouter");
require("dotenv").config();

const app = express();
app.use(cors());
app.use(transcriptionRouter);

app.get("/", () => console.log("Hello world"));

const server = http.createServer(app);

console.log("Key is : ", process.env.OPENAI_API_KEY);

const wss = new WebSocketServer({
  server,
  path: "/live-transcription",
});

// -----------------------------
wss.on("connection", async (ws) => {
  console.log("Client connected to live transcription");

  let audioChunks = [];
  let isProcessing = false;
  let chunkCounter = 0;
  let lastAudioReceivedTime = Date.now();
  let noAudioTimeout = null;

  const CHUNK_DURATION_MS = 2000; // Process every 3 seconds
  const SAMPLE_RATE = 16000;
  const BYTES_PER_SAMPLE = 2; // 16-bit PCM
  const CHUNK_SIZE =
    ((SAMPLE_RATE * CHUNK_DURATION_MS) / 1000) * BYTES_PER_SAMPLE;
  const NO_AUDIO_TIMEOUT_MS = 3000; // Close connection after 3 seconds of no audio
  const SILENCE_THRESHOLD = 0.01; // RMS threshold to detect silence

  ws.send(
    JSON.stringify({
      status: "connected",
      message: "Live transcription using Whisper (chunked processing)",
    })
  );

  // Calculate RMS (Root Mean Square) to detect silence
  const calculateRMS = (buffer) => {
    let sum = 0;
    const view = new DataView(
      buffer.buffer,
      buffer.byteOffset,
      buffer.byteLength
    );

    for (let i = 0; i < buffer.length; i += 2) {
      const sample = view.getInt16(i, true) / 32768.0; // Normalize to -1 to 1
      sum += sample * sample;
    }

    return Math.sqrt(sum / (buffer.length / 2));
  };

  // Check for no audio timeout
  const checkNoAudioTimeout = () => {
    const timeSinceLastAudio = Date.now() - lastAudioReceivedTime;

    if (timeSinceLastAudio >= NO_AUDIO_TIMEOUT_MS) {
      console.log("No audio received for 3 seconds, closing connection");
      ws.send(
        JSON.stringify({
          status: "timeout",
          message: "Connection closed due to inactivity",
        })
      );
      ws.close();
    }
  };

  // Process audio chunks periodically
  const processAudioChunk = async () => {
    if (isProcessing || audioChunks.length === 0) return;

    isProcessing = true;

    try {
      // Combine all buffered chunks
      const combinedBuffer = Buffer.concat(audioChunks);
      audioChunks = [];

      // Check if audio is mostly silence
      const rms = calculateRMS(combinedBuffer);
      console.log(`Audio RMS level: ${rms.toFixed(4)}`);

      // Skip processing if audio is silence
      if (rms < SILENCE_THRESHOLD) {
        console.log("Detected silence, skipping transcription");
        isProcessing = false;
        return;
      }

      // Save to temporary file
      const tempFileName = `uploads/temp_audio_${Date.now()}_${chunkCounter++}.wav`;

      // Create WAV file header
      const wavHeader = createWavHeader(combinedBuffer.length, SAMPLE_RATE);
      const wavFile = Buffer.concat([wavHeader, combinedBuffer]);

      fs.writeFileSync(tempFileName, wavFile);

      // Send to Whisper API with prompt to reduce hallucinations
      const formData = new FormData();
      formData.append("file", fs.createReadStream(tempFileName));
      formData.append("model", "whisper-1");
      formData.append("response_format", "json");
      formData.append("language", "en"); // Specify language to reduce hallucinations
      // Use a prompt that discourages punctuation
      formData.append("prompt", "transcribe without punctuation");

      const response = await axios.post(
        "https://api.openai.com/v1/audio/transcriptions",
        formData,
        {
          headers: {
            ...formData.getHeaders(),
            Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          },
        }
      );

      // Clean up temp file
      fs.unlinkSync(tempFileName);

      // Remove all punctuation from the transcribed text
      let text = response.data.text?.trim() || "";

      // Remove all punctuation marks but keep spaces
      text = text
        .replace(/[.,!?;:'"()\[\]{}\-—–]/g, "")
        .replace(/\s+/g, " ")
        .trim();

      // Filter out common hallucination patterns (now without punctuation)
      const hallucinations = [
        /^(thank you|thanks)$/i,
        /^you$/i,
        /MBC 뉴스/i,
        /チャンネル登録/i,
        /지금까지/i,
        /구독/i,
        /subscribe$/i,
        /^(uh|um|hmm)$/i,
      ];

      const isHallucination = hallucinations.some((pattern) =>
        pattern.test(text)
      );
      const isTooShort = text.length < 3;
      const isRepeated =
        text.split(" ").length > 3 &&
        new Set(text.split(" ")).size < text.split(" ").length * 0.5;

      // Send transcription to client only if it's meaningful
      if (text && !isHallucination && !isTooShort && !isRepeated) {
        console.log("Sending transcript:", text);
        ws.send(
          JSON.stringify({
            transcript: text,
            isFinal: true,
            isTurn: true,
            timestamp: new Date().toISOString(),
          })
        );
      } else {
        console.log("Filtered out likely hallucination:", text);
      }
    } catch (error) {
      console.error(
        "Error processing audio chunk:",
        error.response?.data || error.message
      );
      // Don't send errors for every failed chunk
    } finally {
      isProcessing = false;
    }
  };

  // Set interval to process chunks
  const processingInterval = setInterval(processAudioChunk, CHUNK_DURATION_MS);

  // Set interval to check for no audio timeout
  noAudioTimeout = setInterval(checkNoAudioTimeout, 1000);

  // Handle incoming audio data from frontend
  ws.on("message", async (data) => {
    try {
      if (data instanceof Buffer) {
        // Update last audio received time
        lastAudioReceivedTime = Date.now();

        // Buffer the audio data
        audioChunks.push(data);

        // If buffer gets too large, process immediately
        const totalSize = audioChunks.reduce(
          (acc, chunk) => acc + chunk.length,
          0
        );
        if (totalSize >= CHUNK_SIZE * 2) {
          processAudioChunk();
        }
      }
    } catch (error) {
      console.error("Error handling audio data:", error);
    }
  });

  // Handle client disconnect
  ws.on("close", async () => {
    console.log("Client disconnected");
    clearInterval(processingInterval);
    clearInterval(noAudioTimeout);

    // Process any remaining meaningful audio
    if (audioChunks.length > 0) {
      const combinedBuffer = Buffer.concat(audioChunks);
      const rms = calculateRMS(combinedBuffer);

      if (rms >= SILENCE_THRESHOLD) {
        await processAudioChunk();
      }
    }
  });
});

// Helper function to create WAV header
function createWavHeader(dataLength, sampleRate) {
  const header = Buffer.alloc(44);

  // "RIFF" chunk descriptor
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + dataLength, 4);
  header.write("WAVE", 8);

  // "fmt " sub-chunk
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16); // Subchunk1Size (16 for PCM)
  header.writeUInt16LE(1, 20); // AudioFormat (1 for PCM)
  header.writeUInt16LE(1, 22); // NumChannels (1 for mono)
  header.writeUInt32LE(sampleRate, 24); // SampleRate
  header.writeUInt32LE(sampleRate * 2, 28); // ByteRate
  header.writeUInt16LE(2, 32); // BlockAlign
  header.writeUInt16LE(16, 34); // BitsPerSample

  // "data" sub-chunk
  header.write("data", 36);
  header.writeUInt32LE(dataLength, 40);

  return header;
}

// Start server
server.listen(3000, () => {
  console.log("Server running on http://localhost:3000");
  console.log("WebSocket available at ws://localhost:3000/live-transcription");
  console.log("Using OpenAI Whisper API for transcription");
});
