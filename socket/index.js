const express = require("express");
const { Server } = require("socket.io");
const http = require("http");
const getUserDetailFromToken = require("../helpers/getUserDetailFromToken");
const UserModel = require("../models/UserModel");
const getConversation = require("../helpers/getConversation");

const {
  ConversationModel,
  MessageModel,
} = require("../models/ConversationModel");

const app = express();

/**socket connection */

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: process.env.FRONTEND_URL,
    credentials: true,
  },
});

/**
 * socket running at http://localhost:8080/
 */

const onlineUser = new Set();
io.on("connection", async (socket) => {
  console.log("connect User", socket.id);

  const token = socket.handshake.auth.token;
  //current user details
  const user = await getUserDetailFromToken(token);

  //create a room
  socket.join(user?._id.toString());
  onlineUser.add(user?._id?.toString());

  io.emit("onlineUser", Array.from(onlineUser));

  // Handle friend request
  socket.on("send-friend-request", async (data) => {
    const { targetUserId } = data;
    const targetUser = await UserModel.findById(targetUserId);
    
    if (targetUser) {
      // Emit to the target user
      io.to(targetUserId).emit("new-friend-request", {
        from: user._id,
        name: user.name,
        profile_pic: user.profile_pic
      });
    }
  });

  // Handle friend request response
  socket.on("friend-request-response", async (data) => {
    const { fromUserId, action } = data;
    const fromUser = await UserModel.findById(fromUserId);
    
    if (fromUser) {
      if (action === 'accept') {
        // Emit to both users that they are now friends
        io.to(fromUserId).emit("friend-request-accepted", {
          userId: user._id,
          name: user.name,
          profile_pic: user.profile_pic
        });
        io.to(user._id.toString()).emit("friend-request-accepted", {
          userId: fromUserId,
          name: fromUser.name,
          profile_pic: fromUser.profile_pic
        });
      } else if (action === 'reject') {
        // Emit to the sender that their request was rejected
        io.to(fromUserId).emit("friend-request-rejected", {
          userId: user._id,
          name: user.name
        });
      }
    }
  });

  socket.on("message-page", async (userId) => {
    console.log("userId", userId);

    const userDetails = await UserModel.findById(userId).select("-password");

    const payload = {
      _id: userDetails?._id,
      name: userDetails?.name,
      phone: userDetails?.phone,
      profile_pic: userDetails?.profile_pic,
      online: onlineUser.has(userId),
    };

    socket.emit("message-user", payload);

    // Get conversation ID
    const conversation = await ConversationModel.findOne({
      $or: [
        {
          sender: user?._id,
          receiver: userId,
        },
        {
          sender: userId,
          receiver: user?._id,
        },
      ],
    });

    if (conversation) {
      socket.emit("conversation-id", {
        conversationId: conversation._id
      });
    }

    //get previous message
    const getConversationMessage = await ConversationModel.findOne({
      $or: [
        {
          sender: user?._id,
          receiver: userId,
        },
        {
          sender: userId,
          receiver: user?._id,
        },
      ],
    })
      .populate({
        path: "messages",
        populate: [
          {
            path: "msgByUserId",
            select: "name profile_pic"
          },
          {
            path: "replyTo",
            populate: {
              path: "msgByUserId",
              select: "name profile_pic"
            }
          }
        ],
        options: { sort: { createdAt: 1 } }
      })
      .sort({ updatedAt: -1 });

    socket.emit("message", getConversationMessage?.messages || []);
  });

  //new message
  socket.on("new massage", async (data) => {
    //check conversation is available both user
    let conversation = await ConversationModel.findOne({
      $or: [
        {
          sender: data?.sender,
          receiver: data?.receiver,
        },
        {
          sender: data?.receiver,
          receiver: data?.sender,
        },
      ],
    });

    //if conversation is not available
    if (!conversation) {
      const createConversation = await ConversationModel({
        sender: data?.sender,
        receiver: data?.receiver,
      });
      conversation = await createConversation.save();
    }

    const message = new MessageModel({
      text: data.text,
      imageUrl: data.imageUrl,
      videoUrl: data.videoUrl,
      fileUrl: data.fileUrl,
      fileName: data.fileName,
      msgByUserId: data?.msgByUserId,
      replyTo: data?.replyTo,
      createdAt: new Date(),
    });
    const saveMessage = await message.save();

    const updateConversation = await ConversationModel.updateOne(
      {
        _id: conversation?._id,
      },
      {
        $push: { messages: saveMessage?._id },
      }
    );

    const getConversationMessage = await ConversationModel.findOne({
      $or: [
        {
          sender: data?.sender,
          receiver: data?.receiver,
        },
        {
          sender: data?.receiver,
          receiver: data?.sender,
        },
      ],
    })
      .populate({
        path: "messages",
        populate: [
          {
            path: "msgByUserId",
            select: "name profile_pic"
          },
          {
            path: "replyTo",
            populate: {
              path: "msgByUserId",
              select: "name profile_pic"
            }
          }
        ],
        options: { sort: { createdAt: 1 } }
      });

    io.to(data?.sender).emit("message", getConversationMessage.messages || []);
    io.to(data?.receiver).emit("message", getConversationMessage.messages || []);

    //send conversation
    const conversationSender = await getConversation(data?.sender);
    const conversationReceiver = await getConversation(data?.receiver);

    io.to(data?.sender).emit("conversation", conversationSender);
    io.to(data?.receiver).emit("conversation", conversationReceiver);
  });

  // Forward message
  socket.on("forward message", async (data) => {
    const { messageId, sender, receiver } = data;

    // Get the original message
    const originalMessage = await MessageModel.findById(messageId);
    if (!originalMessage) {
      socket.emit("error", "Không tìm thấy tin nhắn");
      return;
    }

    // Create new conversation if needed
    let conversation = await ConversationModel.findOne({
      $or: [
        {
          sender: sender,
          receiver: receiver,
        },
        {
          sender: receiver,
          receiver: sender,
        },
      ],
    });

    if (!conversation) {
      const createConversation = await ConversationModel({
        sender: sender,
        receiver: receiver,
      });
      conversation = await createConversation.save();
    }

    // Create forwarded message
    const message = new MessageModel({
      text: originalMessage.text,
      imageUrl: originalMessage.imageUrl,
      videoUrl: originalMessage.videoUrl,
      msgByUserId: sender,
      forwardFrom: messageId
    });
    const saveMessage = await message.save();

    // Update conversation
    await ConversationModel.updateOne(
      {
        _id: conversation?._id,
      },
      {
        $push: { messages: saveMessage?._id },
      }
    );

    // Get updated conversation
    const getConversationMessage = await ConversationModel.findOne({
      $or: [
        {
          sender: sender,
          receiver: receiver,
        },
        {
          sender: receiver,
          receiver: sender,
        },
      ],
    })
      .populate("messages")
      .sort({ updatedAt: -1 });

    // Emit updated messages to both users
    io.to(sender).emit("message", getConversationMessage.messages || []);
    io.to(receiver).emit("message", getConversationMessage.messages || []);

    // Update conversations list
    const conversationSender = await getConversation(sender);
    const conversationReceiver = await getConversation(receiver);

    io.to(sender).emit("conversation", conversationSender);
    io.to(receiver).emit("conversation", conversationReceiver);
  });

  //sidebar
  socket.on("sidebar", async (currenUserId) => {
    console.log("currenUserId", currenUserId);
    const conversation = await getConversation(currenUserId);
    socket.emit("conversation", conversation);
  });

  socket.on("seen", async (msgByUserId) => {
    const conversation = await ConversationModel.findOne({
      $or: [
        {
          sender: user?._id,
          receiver: msgByUserId,
        },
        {
          sender: msgByUserId,
          receiver: user?._id,
        },
      ],
    });

    if (!conversation) {
      console.warn("No conversation found for seen event");
      return; // hoặc xử lý gì đó nhẹ nhàng
    }

    const conversationMessageId = conversation.messages || [];

    await MessageModel.updateMany(
      { _id: { $in: conversationMessageId }, msgByUserId: msgByUserId },
      { $set: { seen: true } }
    );

    const conversationSender = await getConversation(user?._id?.toString());
    const conversationReceiver = await getConversation(msgByUserId);

    io.to(user?._id?.toString()).emit("conversation", conversationSender);
    io.to(msgByUserId).emit("conversation", conversationReceiver);
  });

  socket.on("get-contacts", async () => {
    try {
      const allUsers = await UserModel.find({ _id: { $ne: user._id } })
        .select("name profile_pic")
        .lean();

      const contactsWithOnlineStatus = allUsers.map(contact => ({
        ...contact,
        online: onlineUser.has(contact._id.toString())
      }));

      socket.emit("contacts", contactsWithOnlineStatus);
    } catch (error) {
      console.error("Lỗi khi lấy danh sách liên hệ:", error);
      socket.emit("error", "Không thể lấy danh sách liên hệ");
    }
  });

  //handle delete message
  socket.on("delete-message", async (data) => {
    const { messageId, senderId, receiverId } = data;
    console.log("Deleting message:", data);

    try {
      // Verify that the sender is the one deleting the message
      const message = await MessageModel.findOne({
        _id: messageId,
        msgByUserId: senderId,
      });

      if (!message) {
        console.log("Message not found or not authorized");
        socket.emit("error", {
          message: "Message not found or not authorized",
        });
        return;
      }

      // Delete the message
      const deleteResult = await MessageModel.deleteOne({ _id: messageId });
      console.log("Delete result:", deleteResult);

      // Remove message reference from conversation
      const updateResult = await ConversationModel.updateOne(
        {
          $or: [
            { sender: senderId, receiver: receiverId },
            { sender: receiverId, receiver: senderId },
          ],
        },
        { $pull: { messages: messageId } }
      );
      console.log("Update conversation result:", updateResult);

      // Get updated conversation with properly sorted messages
      const updatedConversation = await ConversationModel.findOne({
        $or: [
          { sender: senderId, receiver: receiverId },
          { sender: receiverId, receiver: senderId },
        ],
      }).populate({
        path: 'messages',
        options: { sort: { 'createdAt': 1 } } // Sort by creation time ascending
      });

      // Make sure messages array exists and is sorted
      const sortedMessages = updatedConversation?.messages || [];
      
      // Send updated messages to both users
      console.log("Sending updated messages to users");
      io.to(senderId).emit("message", sortedMessages);
      io.to(receiverId).emit("message", sortedMessages);

      // Update conversation list for both users
      const conversationSender = await getConversation(senderId);
      const conversationReceiver = await getConversation(receiverId);

      io.to(senderId).emit("conversation", conversationSender);
      io.to(receiverId).emit("conversation", conversationReceiver);

      // Send success response
      socket.emit("delete-message-success", { messageId });
    } catch (error) {
      console.error("Error deleting message:", error);
      socket.emit("error", { message: "Failed to delete message" });
    }
  });

  // Handle message reactions
  socket.on("react_to_message", async (data) => {
    const { messageId, emoji } = data;

    try {
      const message = await MessageModel.findById(messageId);
      if (!message) {
        socket.emit("error", "Không tìm thấy tin nhắn");
        return;
      }

      // Kiểm tra xem user đã reaction chưa
      const existingReactionIndex = message.reactions.findIndex(
        r => r.userId.toString() === user._id.toString() && r.emoji === emoji
      );

      if (existingReactionIndex > -1) {
        // Nếu đã có reaction giống vậy thì xóa đi
        message.reactions.splice(existingReactionIndex, 1);
      } else {
        // Xóa reaction cũ của user (nếu có)
        const userReactionIndex = message.reactions.findIndex(
          r => r.userId.toString() === user._id.toString()
        );
        if (userReactionIndex > -1) {
          message.reactions.splice(userReactionIndex, 1);
        }
        // Thêm reaction mới
        message.reactions.push({
          emoji,
          userId: user._id
        });
      }

      await message.save();

      // Lấy conversation và emit lại messages cho cả 2 bên
      const conversation = await ConversationModel.findOne({
        messages: messageId
      });

      if (conversation) {
        const getConversationMessage = await ConversationModel.findById(conversation._id)
          .populate("messages")
          .sort({ updatedAt: -1 });

        io.to(conversation.sender.toString()).emit(
          "message",
          getConversationMessage.messages || []
        );
        io.to(conversation.receiver.toString()).emit(
          "message",
          getConversationMessage.messages || []
        );
      }
    } catch (error) {
      console.error("Lỗi khi xử lý reaction:", error);
      socket.emit("error", "Không thể thêm reaction");
    }
  });

  // Handle message search
  socket.on("search-messages", async (data) => {
    try {
      const { search, conversationId, currentUserId } = data;
      
      // Find the conversation and verify the user is part of it
      const conversation = await ConversationModel.findOne({
        _id: conversationId,
        $or: [
          { sender: currentUserId },
          { receiver: currentUserId }
        ]
      });

      if (!conversation) {
        socket.emit("search-messages-error", {
          message: "Conversation not found or you don't have access to it"
        });
        return;
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
      .sort({ createdAt: -1 })
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

      // Emit search results to the client
      socket.emit("search-messages-result", {
        success: true,
        data: formattedMessages
      });

    } catch (error) {
      console.error("Error in search-messages socket:", error);
      socket.emit("search-messages-error", {
        message: "Error searching messages",
        error: error.message
      });
    }
  });

  //dissconnect
  socket.on("disconnect", () => {
    console.log("disconnect User", socket.id);
    onlineUser.delete(user?._id?.toString());
    io.emit("onlineUser", Array.from(onlineUser));
  });
});

module.exports = {
  app,
  server,
};
