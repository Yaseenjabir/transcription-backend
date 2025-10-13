// assembly.js
require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { WebSocketServer } = require("ws");
const { AssemblyAI } = require("assemblyai");
const http = require("http");
const transcriptionRouter = require("./router/transcriptionRouter");
const savingRouter = require("./router/savingRouter");
const mongoose = require("mongoose");
const app = express();
app.use(cors());
app.use(express.json());
app.use(transcriptionRouter);
app.use(savingRouter);

const connectDB = async () => {
  try {
    const conn = await mongoose.connect(process.env.MONGO_DB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log(`MongoDB Connected: ${conn.connection.host}`);
  } catch (err) {
    console.error("MongoDB connection error:", err);
    process.exit(1); // Exit process with failure
  }
};
connectDB();

app.get("/", (req, res) => {
  return res.json({
    ASSEMBLY_API_KEY: process.env.ASSEMBLY_API_KEY,
    MONGO_DB_URI: process.env.MONGO_DB_URI,
  });
});

const server = http.createServer(app);

// Create WebSocket server
const wss = new WebSocketServer({ server });

// AssemblyAI configuration
let CONNECTION_PARAMS = {};

wss.on("connection", (clientWs) => {
  console.log("Client connected to WebSocket server");

  let assemblyTranscriber = null;
  let isAssemblyConnected = false;
  let audioBuffer = Buffer.alloc(0);
  const BUFFER_SIZE = 8000; // ~100ms at 16kHz, 16-bit = 32000 bytes/sec

  // Initialize AssemblyAI client
  const client = new AssemblyAI({
    apiKey: process.env.ASSEMBLY_API_KEY,
  });

  // Handle messages from client
  clientWs.on("message", async (message) => {
    try {
      const data = JSON.parse(message);

      CONNECTION_PARAMS = data.config;
      if (data.type === "start") {
        console.log("Starting transcription session");

        // Create transcriber
        console.log("CONNECTION_PARAMS are:", CONNECTION_PARAMS);
        assemblyTranscriber = client.streaming.transcriber(CONNECTION_PARAMS);

        // Set up event handlers for AssemblyAI
        assemblyTranscriber.on("open", ({ id }) => {
          console.log(`AssemblyAI session opened with ID: ${id}`);
          isAssemblyConnected = true;

          clientWs.send(
            JSON.stringify({
              type: "session_opened",
              sessionId: id,
            })
          );
        });

        assemblyTranscriber.on("error", (error) => {
          clientWs.send(
            JSON.stringify({
              type: "error",
              error: error.message,
            })
          );
        });

        assemblyTranscriber.on("close", (code, reason) => {
          isAssemblyConnected = false;
          audioBuffer = Buffer.alloc(0);
          clientWs.send(
            JSON.stringify({
              type: "session_closed",
              code,
              reason,
            })
          );
        });

        // Handle turns (when formatTurns is enabled)
        assemblyTranscriber.on("turn", (turn) => {
          if (turn.transcript) {
            clientWs.send(
              JSON.stringify({
                type: "turn",
                text: turn.transcript,
                turn_is_formatted: turn.turn_is_formatted,
                end_of_turn: turn.end_of_turn,
              })
            );
          }
        });

        // Connect to AssemblyAI
        await assemblyTranscriber.connect();
        console.log("Connected to AssemblyAI");
      } else if (data.type === "stop") {
        // Handle stop command
        console.log("Stopping transcription session");
        isAssemblyConnected = false;

        // Send any remaining buffered audio
        if (audioBuffer.length > 0 && assemblyTranscriber) {
          try {
            assemblyTranscriber.sendAudio(audioBuffer);
          } catch (err) {
            console.error("Error sending final audio:", err.message);
          }
        }

        audioBuffer = Buffer.alloc(0);

        if (assemblyTranscriber) {
          await assemblyTranscriber.close();
          assemblyTranscriber = null;
        }
      } else if (data.type === "audio") {
        // Handle audio data
        if (data.audio) {
          // Convert base64 audio to buffer
          const incomingAudio = Buffer.from(data.audio, "base64");

          // Add to buffer
          audioBuffer = Buffer.concat([audioBuffer, incomingAudio]);

          // Send buffer when it reaches the minimum size
          if (
            audioBuffer.length >= BUFFER_SIZE &&
            isAssemblyConnected &&
            assemblyTranscriber
          ) {
            try {
              assemblyTranscriber.sendAudio(audioBuffer);
              audioBuffer = Buffer.alloc(0); // Clear buffer after sending
            } catch (err) {
              console.error("Error sending audio:", err.message);
              if (err.message.includes("Socket is not open")) {
                isAssemblyConnected = false;
              }
            }
          }
        }
      }
    } catch (error) {
      console.error("Error processing message:", error);
      clientWs.send(
        JSON.stringify({
          type: "error",
          error: error.message,
        })
      );
    }
  });

  // Handle client disconnect
  clientWs.on("close", async () => {
    console.log("Client disconnected");
    isAssemblyConnected = false;
    audioBuffer = Buffer.alloc(0);
    if (assemblyTranscriber) {
      try {
        await assemblyTranscriber.close();
      } catch (err) {
        console.error("Error closing transcriber:", err.message);
      }
      assemblyTranscriber = null;
    }
  });

  // Handle errors
  clientWs.on("error", (error) => {
    console.error("WebSocket error:", error);
  });
});

// Start server
server.listen(3000, () => {
  console.log("Server running on http://localhost:3000");
});
