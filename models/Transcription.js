const mongoose = require("mongoose");

const transcriptionSchema = new mongoose.Schema({
  text: {
    type: String,
    required: true,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  category: {
    type: String,
    enum: ["live", "audio"],
    required: true,
  },
});

const Transcription = mongoose.model("Transcription", transcriptionSchema);

module.exports = Transcription;
