const mongoose = require("mongoose");

const groupChatSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Vui lòng nhập tên nhóm"],
      trim: true,
    },
    creator: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    members: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: "User"
    }],
    avatar: {
      type: String,
      default: "",
    },
    lastMessage: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Message",
    },
    messages: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: "Message"
    }],
    isGroup: {
      type: Boolean,
      default: true
    },
    unseenMessages: [{
      userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User"
      },
      count: {
        type: Number,
        default: 0
      },
      lastSeenMessage: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Message"
      }
    }],
    createdAt: {
      type: Date,
      default: Date.now
    }
  },
  {
    timestamps: true,
  }
);

const GroupChatModel = mongoose.model("GroupChat", groupChatSchema);

module.exports = GroupChatModel; 