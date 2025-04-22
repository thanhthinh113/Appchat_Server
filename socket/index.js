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
    const currentUser = await UserModel.findById(user._id);

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
        match: { _id: { $nin: currentUser?.deletedMessages || [] } },
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

      // Lấy tin nhắn cho người gửi (không bao gồm tin nhắn đã xóa của họ)
      const senderUser = await UserModel.findById(data.sender);
      const getConversationMessageForSender = await ConversationModel.findOne({
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
          match: { _id: { $nin: senderUser?.deletedMessages || [] } },
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

      // Lấy tin nhắn cho người nhận (không bao gồm tin nhắn đã xóa của họ)
      const receiverUser = await UserModel.findById(data.receiver);
      const getConversationMessageForReceiver = await ConversationModel.findOne({
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
          match: { _id: { $nin: receiverUser?.deletedMessages || [] } },
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

      io.to(data?.sender).emit("message", getConversationMessageForSender.messages || []);
      io.to(data?.receiver).emit("message", getConversationMessageForReceiver.messages || []);

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
      const { messageId, sender, receiver, currentChatUserId } = data;

      // Kiểm tra xem người nhận có phải là bạn bè không
      const currentUser = await UserModel.findById(sender);
      const targetUser = await UserModel.findById(receiver);
      
      if (!currentUser || !targetUser) {
        socket.emit("error", "Người dùng không tồn tại");
        return;
      }

      if (!currentUser.friends.includes(receiver)) {
        socket.emit("error", "Bạn chỉ có thể chuyển tiếp tin nhắn cho bạn bè");
        return;
      }

      // Kiểm tra không được chuyển tiếp cho chính mình
      if (sender === receiver) {
        socket.emit("error", "Không thể chuyển tiếp tin nhắn cho chính mình");
        return;
      }

      // Get the original message with full details
      const originalMessage = await MessageModel.findById(messageId)
        .populate({
          path: "msgByUserId",
          select: "name profile_pic"
        });

      if (!originalMessage) {
        socket.emit("error", "Không tìm thấy tin nhắn");
        return;
      }

      // Create new conversation if needed
      let conversation = await ConversationModel.findOne({
        $or: [
          { sender: sender, receiver: receiver },
          { sender: receiver, receiver: sender },
        ],
      });

      if (!conversation) {
        conversation = await ConversationModel.create({
          sender: sender,
          receiver: receiver,
        });
      }

      // Create forwarded message
      const message = new MessageModel({
        text: originalMessage.text,
        imageUrl: originalMessage.imageUrl,
        videoUrl: originalMessage.videoUrl,
        fileUrl: originalMessage.fileUrl,
        fileName: originalMessage.fileName,
        msgByUserId: sender,
        forwardFrom: originalMessage._id,
        createdAt: new Date()
      });
      
      const saveMessage = await message.save();

      // Update conversation
      await ConversationModel.updateOne(
        { _id: conversation._id },
        { $push: { messages: saveMessage._id } }
      );

      // Get updated conversation with full details
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

      // Emit updated messages to both users
      io.to(sender).emit("message", getConversationMessage.messages || []);
      io.to(receiver).emit("message", getConversationMessage.messages || []);

      // Update conversations list
      const conversationSender = await getConversation(sender);
      const conversationReceiver = await getConversation(receiver);

      io.to(sender).emit("conversation", conversationSender);
      io.to(receiver).emit("conversation", conversationReceiver);

      // Load lại tin nhắn của cuộc trò chuyện hiện tại
      const currentConversation = await ConversationModel.findOne({
        $or: [
          { sender: sender, receiver: currentChatUserId },
          { sender: currentChatUserId, receiver: sender },
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
              path: "forwardFrom",
              populate: {
                path: "msgByUserId",
                select: "name profile_pic"
              }
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

      if (currentConversation) {
        io.to(sender).emit("message", currentConversation.messages || []);
      }

      // Send success notification
      socket.emit("forward-message-success", {
        messageId: saveMessage._id,
        originalMessageId: originalMessage._id
      });

    } catch (error) {
      console.error("Error forwarding message:", error);
      socket.emit("error", "Không thể chuyển tiếp tin nhắn");
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
    try {
      const { messageId, userId, conversationId } = data;
      const message = await MessageModel.findById(messageId);
      
      if (!message) {
        socket.emit("delete-message-error", { error: "Message not found" });
        return;
      }

      // Kiểm tra người dùng có trong cuộc trò chuyện không
      const conversation = await ConversationModel.findById(conversationId);
      if (!conversation) {
        socket.emit("delete-message-error", { error: "Conversation not found" });
        return;
      }

      // Kiểm tra người dùng có trong cuộc trò chuyện
      const isUserInConversation = conversation.sender.toString() === userId.toString() || 
                                  conversation.receiver.toString() === userId.toString();
      
      if (!isUserInConversation) {
        socket.emit("delete-message-error", { error: "User not in conversation" });
        return;
      }

      // Thêm tin nhắn vào danh sách đã xóa của người dùng
      await UserModel.findByIdAndUpdate(userId, {
        $addToSet: { deletedMessages: messageId }
      });

      // Gửi thông báo xóa tin nhắn thành công cho người gửi
      socket.emit("delete-message-success", { messageId });

      // Lấy danh sách tin nhắn đã xóa của người dùng
      const user = await UserModel.findById(userId);
      const deletedMessages = user.deletedMessages || [];

      // Lấy danh sách tin nhắn đã cập nhật cho người xóa
      const updatedConversation = await ConversationModel.findById(conversationId)
        .populate({
          path: 'messages',
          match: { _id: { $nin: deletedMessages } }, // Lọc tất cả tin nhắn đã xóa
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

      // Chỉ gửi tin nhắn cập nhật cho người xóa
      io.to(userId).emit("message", updatedConversation.messages || []);

    } catch (error) {
      console.error("Error deleting message:", error);
      socket.emit("delete-message-error", { error: error.message });
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

      // Lấy thông tin người dùng để gửi về client
      const user = await UserModel.findById(userId).select("name profile_pic");

      // Gửi thông báo cập nhật reaction cho cả hai người dùng
      const conversation = await ConversationModel.findOne({
        messages: messageId
      });

      if (conversation) {
        // Gửi thông tin cập nhật reaction
        const reactionUpdate = {
          messageId,
          reactions: message.reactions,
          user: {
            _id: user._id,
            name: user.name,
            profile_pic: user.profile_pic
          }
        };

        // Chỉ gửi thông tin cập nhật reaction, không gửi lại toàn bộ danh sách tin nhắn
        io.to(conversation.sender.toString()).emit("reaction-updated", reactionUpdate);
        io.to(conversation.receiver.toString()).emit("reaction-updated", reactionUpdate);
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

  // Handle recall message
  socket.on("recall-message", async (data) => {
    try {
      const { messageId, userId, conversationId } = data;
      const message = await MessageModel.findById(messageId);
      
      if (!message) {
        socket.emit("recall-message-error", { error: "Message not found" });
        return;
      }

      // Kiểm tra xem người dùng có phải là người gửi tin nhắn không
      if (message.msgByUserId.toString() !== userId) {
        socket.emit("recall-message-error", { error: "You can only recall your own messages" });
        return;
      }

      // Kiểm tra người dùng có trong cuộc trò chuyện không
      const conversation = await ConversationModel.findById(conversationId);
      if (!conversation) {
        socket.emit("recall-message-error", { error: "Conversation not found" });
        return;
      }

      // Kiểm tra người dùng có trong cuộc trò chuyện
      const isUserInConversation = conversation.sender.toString() === userId.toString() || 
                                  conversation.receiver.toString() === userId.toString();
      
      if (!isUserInConversation) {
        socket.emit("recall-message-error", { error: "User not in conversation" });
        return;
      }

      // Đánh dấu tin nhắn đã thu hồi
      message.isRecalled = true;
      await message.save();

      // Gửi thông báo thu hồi tin nhắn thành công cho người gửi
      socket.emit("recall-message-success", { messageId });

      // Lấy danh sách tin nhắn đã xóa của người dùng
      const senderUser = await UserModel.findById(conversation.sender);
      const receiverUser = await UserModel.findById(conversation.receiver);

      // Lấy danh sách tin nhắn đã cập nhật cho người gửi
      const updatedConversationForSender = await ConversationModel.findById(conversationId)
        .populate({
          path: 'messages',
          match: { _id: { $nin: senderUser?.deletedMessages || [] } },
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

      // Lấy danh sách tin nhắn đã cập nhật cho người nhận
      const updatedConversationForReceiver = await ConversationModel.findById(conversationId)
        .populate({
          path: 'messages',
          match: { _id: { $nin: receiverUser?.deletedMessages || [] } },
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

      // Gửi tin nhắn cập nhật cho từng người dùng
      io.to(conversation.sender.toString()).emit("message", updatedConversationForSender.messages || []);
      io.to(conversation.receiver.toString()).emit("message", updatedConversationForReceiver.messages || []);

    } catch (error) {
      console.error("Error recalling message:", error);
      socket.emit("recall-message-error", { error: error.message });
    }
  });
});

module.exports = {
  app,
  server,
};
