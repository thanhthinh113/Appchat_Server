const { ConversationModel, MessageModel } = require("../models/ConversationModel");

const searchMessage = async (req, res) => {
  try {
    const { search, conversationId, currentUserId } = req.body;

    if (!conversationId || !currentUserId) {
      return res.status(400).json({
        message: "Conversation ID and current user ID are required",
        error: true,
      });
    }

    // Find the conversation and verify the user is part of it
    const conversation = await ConversationModel.findOne({
      _id: conversationId,
      $or: [
        { sender: currentUserId },
        { receiver: currentUserId }
      ]
    });

    if (!conversation) {
      return res.status(404).json({
        message: "Conversation not found or you don't have access to it",
        error: true,
      });
    }

    // Create case-insensitive regex for search
    const searchRegex = new RegExp(search, "i");

    // Find messages in the conversation that match the search term
    const messages = await MessageModel.find({
      _id: { $in: conversation.messages },
      $or: [
        { text: searchRegex },
        { imageUrl: { $regex: searchRegex } },
        { videoUrl: { $regex: searchRegex } }
      ]
    })
    .sort({ createdAt: -1 }) // Sort by newest first
    .populate({
      path: 'msgByUserId',
      select: 'name profile_pic'
    });

    // Format the response
    const formattedMessages = messages.map(message => ({
      _id: message._id,
      text: message.text,
      imageUrl: message.imageUrl,
      videoUrl: message.videoUrl,
      msgByUserId: {
        _id: message.msgByUserId._id,
        name: message.msgByUserId.name,
        profile_pic: message.msgByUserId.profile_pic
      },
      createdAt: message.createdAt,
      seen: message.seen,
      reactions: message.reactions || [],
      forwardFrom: message.forwardFrom
    }));

    return res.json({
      message: "Messages found",
      data: formattedMessages,
      success: true,
    });
  } catch (error) {
    console.error("Error in searchMessage:", error);
    return res.status(500).json({
      message: error.message || "Error searching messages",
      error: true,
    });
  }
};

module.exports = searchMessage; 