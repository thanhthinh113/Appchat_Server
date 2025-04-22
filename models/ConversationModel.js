const mongoose = require("mongoose");

const messageSchema = new mongoose.Schema(
  {
    text: {
      type: String,
      default: "",
    },
    imageUrl: {
      type: String,
      default: "",
    },
    videoUrl: {
      type: String,
      default: "",
    },
    fileUrl: {
      type: String,
    },
    fileName: {
      type: String,
    },
    seen: {
      type: Boolean,
      default: false,
    },
    msgByUserId: {
      type: mongoose.Schema.ObjectId,
      required: true,
      ref: "User",
    },
    forwardFrom: {
      type: mongoose.Schema.ObjectId,
      ref: "Message",
      default: null
    },
    replyTo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Message",
    },
    reactions: [{
      emoji: {
        type: String,
        required: true
      },
      userId: {
        type: mongoose.Schema.ObjectId,
        required: true,
        ref: "User"
      }
    }]
  },
  {
    timestamps: true,
  }
);

// Add index for createdAt to ensure proper sorting
messageSchema.index({ createdAt: 1 });

const conversationSchema = new mongoose.Schema(
  {
    sender: {
      type: mongoose.Schema.ObjectId,
      required: true,
      ref: "User",
    },
    receiver: {
      type: mongoose.Schema.ObjectId,
      required: true,
      ref: "User",
    },
    messages: [
      {
        type: mongoose.Schema.ObjectId,
        ref: "Message",
      },
    ],
    lastMessage: {
      type: mongoose.Schema.ObjectId,
      ref: "Message",
    },
    lastMessageTime: {
      type: Date,
      default: Date.now
    }
  },
  {
    timestamps: true,
  }
);

// Add compound index for sender and receiver to optimize queries
conversationSchema.index({ sender: 1, receiver: 1 });

const MessageModel = mongoose.model("Message", messageSchema);
const ConversationModel = mongoose.model("Conversation", conversationSchema);

module.exports = { MessageModel, ConversationModel };
