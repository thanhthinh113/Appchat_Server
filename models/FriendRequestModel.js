const mongoose = require("mongoose");

const friendRequestSchema = new mongoose.Schema(
  {
    sender: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    receiver: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    status: {
      type: String,
      enum: ["pending", "accepted", "rejected"],
      default: "pending",
    },
  },
  {
    timestamps: true,
  }
);

// Tạo compound index cho sender và receiver với điều kiện status là pending
friendRequestSchema.index(
  { sender: 1, receiver: 1 },
  { 
    unique: true,
    partialFilterExpression: { status: "pending" }
  }
);

// Tạo pre-save middleware để kiểm tra yêu cầu kết bạn đang pending
friendRequestSchema.pre('save', async function(next) {
  if (this.isNew && this.status === 'pending') {
    // Xóa các yêu cầu kết bạn cũ giữa hai người dùng
    await this.constructor.deleteMany({
      $or: [
        { sender: this.sender, receiver: this.receiver },
        { sender: this.receiver, receiver: this.sender }
      ]
    });
  }
  next();
});

const FriendRequestModel = mongoose.model("FriendRequest", friendRequestSchema);

module.exports = FriendRequestModel; 