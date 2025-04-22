const express = require("express");
const { Server } = require("socket.io");
const http = require("http");
const getUserDetailFromToken = require("../helpers/getUserDetailFromToken");
const UserModel = require("../models/UserModel");
const getConversation = require("../helpers/getConversation");
const FriendRequestModel = require("../models/FriendRequestModel");

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
    try {
      const { targetUserId } = data;
      const currentUser = await UserModel.findById(user._id);
      const targetUser = await UserModel.findById(targetUserId);
      
      if (!currentUser || !targetUser) {
        socket.emit("error", "Người dùng không tồn tại");
        return;
      }
      
      if (currentUser.friends.includes(targetUserId)) {
        socket.emit("error", "Các bạn đã là bạn bè");
        return;
      }
      
      // Xóa yêu cầu kết bạn cũ nếu có
      await FriendRequestModel.deleteMany({
        $or: [
          { sender: user._id, receiver: targetUserId },
          { sender: targetUserId, receiver: user._id }
        ]
      });
      
      const newRequest = new FriendRequestModel({
        sender: user._id,
        receiver: targetUserId,
        status: 'pending'
      });
      
      await newRequest.save();
      
      if (onlineUser.has(targetUserId)) {
        io.to(targetUserId).emit("new-friend-request", {
          requestId: newRequest._id,
          sender: {
            _id: currentUser._id,
            name: currentUser.name,
            profile_pic: currentUser.profile_pic
          }
        });
      }
      
      socket.emit("friend-request-sent", { 
        success: true,
        requestId: newRequest._id
      });
      
    } catch (error) {
      console.error("Error sending friend request:", error);
      socket.emit("error", "Có lỗi xảy ra khi gửi yêu cầu kết bạn");
    }
  });

  // Handle friend request response
  socket.on("friend-request-response", async (data) => {
    try {
      const { requestId, action } = data;
      
      const friendRequest = await FriendRequestModel.findById(requestId);
      
      if (!friendRequest) {
        socket.emit("error", "Không tìm thấy yêu cầu kết bạn");
        return;
      }
      
      if (friendRequest.receiver.toString() !== user._id.toString()) {
        socket.emit("error", "Bạn không có quyền xử lý yêu cầu này");
        return;
      }
      
      if (action === 'accept') {
        // Thêm vào danh sách bạn bè
        await UserModel.updateOne(
          { _id: friendRequest.sender },
          { $addToSet: { friends: friendRequest.receiver } }
        );
        await UserModel.updateOne(
          { _id: friendRequest.receiver },
          { $addToSet: { friends: friendRequest.sender } }
        );
        
        // Thông báo cho người gửi
        if (onlineUser.has(friendRequest.sender.toString())) {
          const receiver = await UserModel.findById(user._id);
          io.to(friendRequest.sender.toString()).emit("friend-request-accepted", {
            requestId: friendRequest._id,
            friend: {
              _id: receiver._id,
              name: receiver.name,
              profile_pic: receiver.profile_pic
            }
          });
        }
        
        // Thông báo cho người nhận
        socket.emit("friend-request-accepted", {
          requestId: friendRequest._id,
          friend: {
            _id: friendRequest.sender,
            name: (await UserModel.findById(friendRequest.sender)).name,
            profile_pic: (await UserModel.findById(friendRequest.sender)).profile_pic
          }
        });
        
      } else if (action === 'reject') {
        // Thông báo cho người gửi
        if (onlineUser.has(friendRequest.sender.toString())) {
          io.to(friendRequest.sender.toString()).emit("friend-request-rejected", {
            requestId: friendRequest._id
          });
        }
        
        // Thông báo cho người nhận
        socket.emit("friend-request-rejected", {
          requestId: friendRequest._id
        });
      }

      // Xóa yêu cầu kết bạn sau khi xử lý xong
      await FriendRequestModel.deleteOne({ _id: requestId });
      
      socket.emit("friend-request-handled", { 
        success: true,
        action,
        requestId: friendRequest._id
      });
      
    } catch (error) {
      console.error("Error handling friend request:", error);
      socket.emit("error", "Có lỗi xảy ra khi xử lý yêu cầu kết bạn");
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
    try {
      // Check if users are friends
      const currentUser = await UserModel.findById(data.sender);
      const targetUser = await UserModel.findById(data.receiver);

      if (!currentUser || !targetUser) {
        socket.emit("error", "Người dùng không tồn tại");
        return;
      }

      const areFriends = currentUser.friends.includes(data.receiver) && 
                        targetUser.friends.includes(data.sender);

      if (!areFriends) {
        socket.emit("error", "Bạn cần kết bạn để có thể nhắn tin");
        return;
      }

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
    } catch (error) {
      console.error("Error sending message:", error);
      socket.emit("error", "Có lỗi xảy ra khi gửi tin nhắn");
    }
  });

  // Handle forward message
  socket.on("forward message", async (data) => {
    try {
      const { messageId, sender, receiver } = data;

      // Kiểm tra xem người nhận có phải là bạn bè không
      const currentUser = await UserModel.findById(sender);
      if (!currentUser.friends.includes(receiver)) {
        socket.emit("error", "You can only forward messages to friends");
        return;
      }

      // Kiểm tra không được chuyển tiếp cho chính mình
      if (sender === receiver) {
        socket.emit("error", "Cannot forward message to yourself");
        return;
      }

      // Get the original message
      const originalMessage = await MessageModel.findById(messageId);
      if (!originalMessage) {
        socket.emit("error", "Message not found");
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
      const getConversationMessage = await ConversationModel.findById(conversation._id)
        .populate({
          path: "messages",
          populate: [
            {
              path: "msgByUserId",
              select: "name profile_pic"
            },
            {
              path: "forwardFrom",
              populate: {
                path: "msgByUserId",
                select: "name profile_pic"
              }
            }
          ],
          options: { sort: { createdAt: 1 } }
        });

      // Emit updated messages to both users
      io.to(sender).emit("message", getConversationMessage.messages || []);
      io.to(receiver).emit("message", getConversationMessage.messages || []);

      // Update conversations list
      const conversationSender = await getConversation(sender);
      const conversationReceiver = await getConversation(receiver);

      io.to(sender).emit("conversation", conversationSender);
      io.to(receiver).emit("conversation", conversationReceiver);
    } catch (error) {
      console.error("Error forwarding message:", error);
      socket.emit("error", "Could not forward message");
    }
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
  socket.on("react_to_message", async (reactionData) => {
    try {
      const { messageId, emoji, userId } = reactionData;
      const message = await MessageModel.findById(messageId);
      
      if (!message) {
        socket.emit("error", "Không tìm thấy tin nhắn");
        return;
      }

      // Initialize reactions array if it doesn't exist
      if (!message.reactions) {
        message.reactions = [];
      }

      // Kiểm tra xem user đã reaction chưa
      const existingReactionIndex = message.reactions.findIndex(
        r => r.userId.toString() === userId.toString() && r.emoji === emoji
      );

      if (existingReactionIndex > -1) {
        // Nếu đã có reaction giống vậy thì xóa đi
        message.reactions.splice(existingReactionIndex, 1);
      } else {
        // Xóa reaction cũ của user (nếu có)
        const userReactionIndex = message.reactions.findIndex(
          r => r.userId.toString() === userId.toString()
        );
        if (userReactionIndex > -1) {
          message.reactions.splice(userReactionIndex, 1);
        }
        // Thêm reaction mới
        message.reactions.push({
          emoji,
          userId
        });
      }

      await message.save();

      // Lấy conversation và emit lại messages cho cả 2 bên
      const conversation = await ConversationModel.findOne({
        messages: messageId
      });

      if (conversation) {
        const getConversationMessage = await ConversationModel.findById(conversation._id)
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

  // Handle unfriend request
  socket.on("unfriend", async (data) => {
    try {
      const { targetUserId } = data;
      const currentUser = await UserModel.findById(user._id);
      const targetUser = await UserModel.findById(targetUserId);
      
      if (!currentUser || !targetUser) {
        socket.emit("error", "Người dùng không tồn tại");
        return;
      }

      // Xóa khỏi danh sách bạn bè của cả hai người dùng
      await UserModel.updateOne(
        { _id: user._id },
        { $pull: { friends: targetUserId } }
      );
      
      await UserModel.updateOne(
        { _id: targetUserId },
        { $pull: { friends: user._id } }
      );

      // Thông báo cho cả hai người dùng
      socket.emit("unfriend-success", {
        targetUserId,
        message: "Đã hủy kết bạn"
      });

      if (onlineUser.has(targetUserId)) {
        io.to(targetUserId).emit("unfriend-received", {
          userId: user._id,
          message: "Đã hủy kết bạn"
        });
      }
      
    } catch (error) {
      console.error("Error unfriending:", error);
      socket.emit("error", "Có lỗi xảy ra khi hủy kết bạn");
    }
  });

  //dissconnect
  socket.on("disconnect", () => {
    console.log("disconnect User", socket.id);
    onlineUser.delete(user?._id?.toString());
    io.emit("onlineUser", Array.from(onlineUser));
  });

  socket.on("get-friends", async () => {
    try {
      const currentUser = await UserModel.findById(user._id);
      if (!currentUser) {
        socket.emit("error", "User not found");
        return;
      }

      // Lấy danh sách bạn bè của người dùng
      const friends = await UserModel.find({
        _id: { $in: currentUser.friends }
      }).select("name profile_pic _id");

      const friendsWithOnlineStatus = friends.map(friend => ({
        ...friend.toObject(),
        online: onlineUser.has(friend._id.toString())
      }));

      socket.emit("friends", friendsWithOnlineStatus);
    } catch (error) {
      console.error("Error getting friends list:", error);
      socket.emit("error", "Could not get friends list");
    }
  });
});

module.exports = {
  app,
  server,
};
