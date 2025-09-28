// const express = require("express");
// const multer = require("multer");
// const fs = require("fs");
// const axios = require("axios");
// const cors = require("cors");
// const { AssemblyAI } = require("assemblyai");
// const { Readable } = require("stream");
// const { WebSocketServer } = require("ws");
// const http = require("http");

// const app = express();
// const upload = multer({ dest: "uploads/" });
// app.use(cors());

// const API_KEY = "eb397b6eeb974bbdb309a7acdaca8c19";

// // Create HTTP server
// const server = http.createServer(app);

// // Create WebSocket server
// const wss = new WebSocketServer({
//   server,
//   path: "/live-transcription",
// });

// // -----------------------------
// // Standard File Upload Transcription (unchanged)
// // -----------------------------
// app.post("/transcribe", upload.single("audio"), async (req, res) => {
//   try {
//     if (!req.file) {
//       return res.status(400).json({ error: "No audio file uploaded" });
//     }

//     const uploadRes = await axios({
//       method: "post",
//       url: "https://api.assemblyai.com/v2/upload",
//       headers: { authorization: API_KEY },
//       data: fs.createReadStream(req.file.path),
//     });

//     const audioUrl = uploadRes.data.upload_url;

//     const transcriptRes = await axios.post(
//       "https://api.assemblyai.com/v2/transcript",
//       { audio_url: audioUrl },
//       {
//         headers: { authorization: API_KEY, "content-type": "application/json" },
//       }
//     );

//     const transcriptId = transcriptRes.data.id;

//     let transcript;
//     while (true) {
//       const pollingRes = await axios.get(
//         `https://api.assemblyai.com/v2/transcript/${transcriptId}`,
//         { headers: { authorization: API_KEY } }
//       );

//       transcript = pollingRes.data;

//       if (transcript.status === "completed") {
//         fs.unlinkSync(req.file.path);
//         return res.json({
//           id: transcriptId,
//           text: transcript.text,
//         });
//       } else if (transcript.status === "error") {
//         fs.unlinkSync(req.file.path);
//         return res.status(500).json({ error: transcript.error });
//       }

//       await new Promise((resolve) => setTimeout(resolve, 3000));
//     }
//   } catch (err) {
//     console.error("Error transcribing:", err.message);
//     return res.status(500).json({ error: "Transcription failed" });
//   }
// });

// // -----------------------------
// // WebSocket Live Transcription Handler
// // -----------------------------
// wss.on("connection", async (ws) => {
//   console.log("Client connected to live transcription");

//   try {
//     const client = new AssemblyAI({ apiKey: API_KEY });

//     const CONNECTION_PARAMS = {
//       sampleRate: 16000,
//       formatTurns: true,
//       endOfTurnConfidenceThreshold: 0.7,
//       minEndOfTurnSilenceWhenConfident: 160,
//       maxTurnSilence: 2400,
//     };

//     const transcriber = client.streaming.transcriber(CONNECTION_PARAMS);

//     // Store transcriber reference on the WebSocket for cleanup
//     ws.transcriber = transcriber;

//     transcriber.on("open", ({ id }) => {
//       console.log(`AssemblyAI session opened: ${id}`);
//       ws.send(JSON.stringify({ status: "connected", sessionId: id }));
//     });

//     transcriber.on("error", (error) => {
//       console.error("AssemblyAI error:", error);
//       ws.send(JSON.stringify({ error: error.message }));
//     });

//     transcriber.on("close", (code, reason) => {
//       console.log("AssemblyAI session closed:", code, reason);
//       ws.send(JSON.stringify({ status: "closed" }));
//     });

//     // Handle partial transcripts (real-time)
//     transcriber.on("transcript", (transcript) => {
//       if (transcript.text && transcript.text.trim()) {
//         console.log("Partial transcript:", transcript.text);
//         ws.send(
//           JSON.stringify({
//             transcript: transcript.text.trim(),
//             confidence: transcript.confidence,
//             isFinal: transcript.message_type === "FinalTranscript",
//           })
//         );
//       }
//     });

//     // Handle complete turns - FINAL FIX: Only send when sentence actually ends
//     let lastSentTranscript = "";

//     transcriber.on("turn", (turn) => {
//       if (turn.transcript && turn.transcript.trim()) {
//         const currentTurn = turn.transcript.trim();
//         console.log("Turn update:", currentTurn);

//         // Only send if:
//         // 1. This turn ends with punctuation (complete sentence)
//         // 2. AND it's different from what we last sent
//         const endsWithPunctuation = /[.!?]$/.test(currentTurn);

//         if (endsWithPunctuation && currentTurn !== lastSentTranscript) {
//           console.log("SENDING COMPLETE SENTENCE:", currentTurn);
//           ws.send(
//             JSON.stringify({
//               transcript: currentTurn,
//               isTurn: true,
//               isFinal: true,
//             })
//           );
//           lastSentTranscript = currentTurn;
//         }
//       }
//     });

//     // Connect to AssemblyAI
//     await transcriber.connect();

//     // Handle incoming audio data from frontend
//     ws.on("message", async (data) => {
//       try {
//         if (data instanceof Buffer) {
//           // Convert WebM audio to PCM format that AssemblyAI expects
//           // Note: You might need audio conversion here
//           // For now, we'll send the raw buffer
//           transcriber.sendAudio(data);
//         }
//       } catch (error) {
//         console.error("Error sending audio to AssemblyAI:", error);
//       }
//     });

//     // Handle client disconnect
//     ws.on("close", async () => {
//       console.log("Client disconnected");

//       if (ws.transcriber) {
//         await ws.transcriber.close();
//       }
//     });
//   } catch (error) {
//     console.error("Error setting up transcriber:", error);
//     ws.send(JSON.stringify({ error: "Failed to initialize transcriber" }));
//   }
// });

// // Start server
// server.listen(3000, () => {
//   console.log("Server running on http://localhost:3000");
//   console.log("WebSocket available at ws://localhost:3000/live-transcription");
// });

const express = require("express");
const multer = require("multer");
const fs = require("fs");
const axios = require("axios");
const cors = require("cors");
const { AssemblyAI } = require("assemblyai");
const { Readable } = require("stream");
const { WebSocketServer } = require("ws");
const http = require("http");

const app = express();
const upload = multer({ dest: "uploads/" });
app.use(cors());

const API_KEY = "eb397b6eeb974bbdb309a7acdaca8c19";

// Create HTTP server
const server = http.createServer(app);

// Create WebSocket server
const wss = new WebSocketServer({
  server,
  path: "/live-transcription",
});

// -----------------------------
// Standard File Upload Transcription (unchanged)
// -----------------------------
app.post("/transcribe", upload.single("audio"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No audio file uploaded" });
    }

    const uploadRes = await axios({
      method: "post",
      url: "https://api.assemblyai.com/v2/upload",
      headers: { authorization: API_KEY },
      data: fs.createReadStream(req.file.path),
    });

    const audioUrl = uploadRes.data.upload_url;

    const transcriptRes = await axios.post(
      "https://api.assemblyai.com/v2/transcript",
      { audio_url: audioUrl },
      {
        headers: { authorization: API_KEY, "content-type": "application/json" },
      }
    );

    const transcriptId = transcriptRes.data.id;

    let transcript;
    while (true) {
      const pollingRes = await axios.get(
        `https://api.assemblyai.com/v2/transcript/${transcriptId}`,
        { headers: { authorization: API_KEY } }
      );

      transcript = pollingRes.data;

      if (transcript.status === "completed") {
        fs.unlinkSync(req.file.path);
        return res.json({
          id: transcriptId,
          text: transcript.text,
        });
      } else if (transcript.status === "error") {
        fs.unlinkSync(req.file.path);
        return res.status(500).json({ error: transcript.error });
      }

      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
  } catch (err) {
    console.error("Error transcribing:", err.message);
    return res.status(500).json({ error: "Transcription failed" });
  }
});

// -----------------------------
// WebSocket Live Transcription Handler
// -----------------------------
wss.on("connection", async (ws) => {
  console.log("Client connected to live transcription");

  try {
    const client = new AssemblyAI({ apiKey: API_KEY });

    const CONNECTION_PARAMS = {
      sampleRate: 16000,
      formatTurns: true,
      endOfTurnConfidenceThreshold: 0.7,
      minEndOfTurnSilenceWhenConfident: 160,
      maxTurnSilence: 2400,
    };

    const transcriber = client.streaming.transcriber(CONNECTION_PARAMS);

    // Store transcriber reference on the WebSocket for cleanup
    ws.transcriber = transcriber;

    transcriber.on("open", ({ id }) => {
      console.log(`AssemblyAI session opened: ${id}`);
      ws.send(JSON.stringify({ status: "connected", sessionId: id }));
    });

    transcriber.on("error", (error) => {
      console.error("AssemblyAI error:", error);
      ws.send(JSON.stringify({ error: error.message }));
    });

    transcriber.on("close", (code, reason) => {
      console.log("AssemblyAI session closed:", code, reason);
      ws.send(JSON.stringify({ status: "closed" }));
    });

    // Handle partial transcripts (real-time) - SHOW IMMEDIATELY
    transcriber.on("transcript", (transcript) => {
      if (transcript.text && transcript.text.trim()) {
        const text = transcript.text.trim();
        console.log("Partial transcript:", text);

        // Send partial transcripts immediately for real-time display
        ws.send(
          JSON.stringify({
            transcript: text,
            confidence: transcript.confidence,
            isFinal: false, // Mark as partial
            isPartial: true,
          })
        );
      }
    });

    // Handle complete turns - SMART FINAL HANDLING
    let lastSentTranscript = "";

    transcriber.on("turn", (turn) => {
      if (turn.transcript && turn.transcript.trim()) {
        const currentTurn = turn.transcript.trim();
        console.log("Turn update:", currentTurn);

        // Only send final turns when they end with punctuation AND are different
        const endsWithPunctuation = /[.!?]$/.test(currentTurn);

        if (endsWithPunctuation && currentTurn !== lastSentTranscript) {
          console.log("SENDING COMPLETE SENTENCE:", currentTurn);
          ws.send(
            JSON.stringify({
              transcript: currentTurn,
              isTurn: true,
              isFinal: true,
            })
          );
          lastSentTranscript = currentTurn;
        }
      }
    });

    // Connect to AssemblyAI
    await transcriber.connect();

    // Handle incoming audio data from frontend
    ws.on("message", async (data) => {
      try {
        if (data instanceof Buffer) {
          // Convert WebM audio to PCM format that AssemblyAI expects
          // Note: You might need audio conversion here
          // For now, we'll send the raw buffer
          transcriber.sendAudio(data);
        }
      } catch (error) {
        console.error("Error sending audio to AssemblyAI:", error);
      }
    });

    // Handle client disconnect
    ws.on("close", async () => {
      console.log("Client disconnected");

      if (ws.transcriber) {
        await ws.transcriber.close();
      }
    });
  } catch (error) {
    console.error("Error setting up transcriber:", error);
    ws.send(JSON.stringify({ error: "Failed to initialize transcriber" }));
  }
});

app.get("/", (req, res) => {
  return res.json({ status: "Okkkk" });
});

// Start server
server.listen(3000, () => {
  console.log("Server running on http://localhost:3000");
  console.log("WebSocket available at ws://localhost:3000/live-transcription");
});
