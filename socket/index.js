const express = require("express");
const { Server } = require("socket.io");
const http = require("http");
const getUserDetailFromToken = require("../helpers/getUserDetailFromToken");
const UserModel = require("../models/UserModel");
const getConversation = require("../helpers/getConversation");
const FriendRequestModel = require("../models/FriendRequestModel");
const GroupChatModel = require("../models/GroupChatModel");
const GroupChat = require("../models/GroupChatModel");

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
  timeout: 10000,
});

/**
 * socket running at http://localhost:8080/
 */

const onlineUser = new Set();
io.on("connection", async (socket) => {
  console.log("connect User", socket.id);

  const token = socket.handshake.auth.token;
  try {
    if (!token) {
      console.error("No token provided");
      socket.emit("error", {
        message: "Authentication failed: No token provided",
      });
      socket.disconnect(true);
      return;
    }

    // Lấy thông tin user từ token
    const user = await getUserDetailFromToken(token);

    // Kiểm tra user có hợp lệ không
    if (!user || !user._id) {
      console.error("Invalid or expired token");
      socket.emit("error", {
        message: "Authentication failed: Invalid or expired token",
      });
      socket.disconnect(true);
      return;
    }

    // Tạo room và thêm vào danh sách online
    const userId = user._id.toString();
    socket.join(userId);
    onlineUser.add(userId);
    io.emit("onlineUser", Array.from(onlineUser));

    socket.userId = userId;

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
            { sender: targetUserId, receiver: user._id },
          ],
        });

        const newRequest = new FriendRequestModel({
          sender: user._id,
          receiver: targetUserId,
          status: "pending",
        });

        await newRequest.save();

        // Emit to target user if online
        if (onlineUser.has(targetUserId.toString())) {
          const populatedRequest = await FriendRequestModel.findById(
            newRequest._id
          )
            .populate("sender", "name profile_pic phone")
            .populate("receiver", "name profile_pic phone");

          io.to(targetUserId.toString()).emit("new-friend-request", {
            requestId: newRequest._id,
            sender: {
              _id: currentUser._id,
              name: currentUser.name,
              profile_pic: currentUser.profile_pic,
              phone: currentUser.phone,
            },
            status: "pending",
          });
        }

        // Emit to sender
        socket.emit("friend-request-sent", {
          success: true,
          requestId: newRequest._id,
          receiver: {
            _id: targetUser._id,
            name: targetUser.name,
            profile_pic: targetUser.profile_pic,
            phone: targetUser.phone,
          },
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

        const friendRequest = await FriendRequestModel.findById(requestId)
          .populate("sender", "name profile_pic phone")
          .populate("receiver", "name profile_pic phone");

        if (!friendRequest) {
          socket.emit("error", "Không tìm thấy yêu cầu kết bạn");
          return;
        }

        if (friendRequest.receiver.toString() !== user._id.toString()) {
          socket.emit("error", "Bạn không có quyền xử lý yêu cầu này");
          return;
        }

        if (action === "accept") {
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
            io.to(friendRequest.sender.toString()).emit(
              "friend-request-accepted",
              {
                requestId: friendRequest._id,
                friend: {
                  _id: friendRequest.receiver._id,
                  name: friendRequest.receiver.name,
                  profile_pic: friendRequest.receiver.profile_pic,
                  phone: friendRequest.receiver.phone,
                },
              }
            );
          }

          // Thông báo cho người nhận
          socket.emit("friend-request-accepted", {
            requestId: friendRequest._id,
            friend: {
              _id: friendRequest.sender._id,
              name: friendRequest.sender.name,
              profile_pic: friendRequest.sender.profile_pic,
              phone: friendRequest.sender.phone,
            },
          });
        } else if (action === "reject") {
          // Thông báo cho người gửi
          if (onlineUser.has(friendRequest.sender.toString())) {
            io.to(friendRequest.sender.toString()).emit(
              "friend-request-rejected",
              {
                requestId: friendRequest._id,
                receiver: {
                  _id: friendRequest.receiver._id,
                  name: friendRequest.receiver.name,
                  profile_pic: friendRequest.receiver.profile_pic,
                  phone: friendRequest.receiver.phone,
                },
              }
            );
          }

          // Thông báo cho người nhận
          socket.emit("friend-request-rejected", {
            requestId: friendRequest._id,
            sender: {
              _id: friendRequest.sender._id,
              name: friendRequest.sender.name,
              profile_pic: friendRequest.sender.profile_pic,
              phone: friendRequest.sender.phone,
            },
          });
        }

        // Xóa yêu cầu kết bạn sau khi xử lý xong
        await FriendRequestModel.deleteOne({ _id: requestId });
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
          conversationId: conversation._id,
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
              select: "name profile_pic",
            },
            {
              path: "replyTo",
              populate: {
                path: "msgByUserId",
                select: "name profile_pic",
              },
            },
          ],
          options: { sort: { createdAt: 1 } },
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

        const areFriends =
          currentUser.friends.includes(data.receiver) &&
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
        const getConversationMessageForSender = await ConversationModel.findOne(
          {
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
          }
        ).populate({
          path: "messages",
          match: { _id: { $nin: senderUser?.deletedMessages || [] } },
          populate: [
            {
              path: "msgByUserId",
              select: "name profile_pic",
            },
            {
              path: "replyTo",
              populate: {
                path: "msgByUserId",
                select: "name profile_pic",
              },
            },
          ],
          options: { sort: { createdAt: 1 } },
        });

        // Lấy tin nhắn cho người nhận (không bao gồm tin nhắn đã xóa của họ)
        const receiverUser = await UserModel.findById(data.receiver);
        const getConversationMessageForReceiver =
          await ConversationModel.findOne({
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
          }).populate({
            path: "messages",
            match: { _id: { $nin: receiverUser?.deletedMessages || [] } },
            populate: [
              {
                path: "msgByUserId",
                select: "name profile_pic",
              },
              {
                path: "replyTo",
                populate: {
                  path: "msgByUserId",
                  select: "name profile_pic",
                },
              },
            ],
            options: { sort: { createdAt: 1 } },
          });

        io.to(data?.sender).emit(
          "message",
          getConversationMessageForSender.messages || []
        );
        io.to(data?.receiver).emit(
          "message",
          getConversationMessageForReceiver.messages || []
        );

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
          socket.emit(
            "error",
            "Bạn chỉ có thể chuyển tiếp tin nhắn cho bạn bè"
          );
          return;
        }

        // Kiểm tra không được chuyển tiếp cho chính mình
        if (sender === receiver) {
          socket.emit("error", "Không thể chuyển tiếp tin nhắn cho chính mình");
          return;
        }

        // Get the original message with full details
        const originalMessage = await MessageModel.findById(messageId).populate(
          {
            path: "msgByUserId",
            select: "name profile_pic",
          }
        );

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
          createdAt: new Date(),
        });

        const saveMessage = await message.save();

        // Update conversation
        await ConversationModel.updateOne(
          { _id: conversation._id },
          { $push: { messages: saveMessage._id } }
        );

        // Get updated conversation with full details
        const getConversationMessage = await ConversationModel.findById(
          conversation._id
        ).populate({
          path: "messages",
          populate: [
            {
              path: "msgByUserId",
              select: "name profile_pic",
            },
            {
              path: "forwardFrom",
              populate: {
                path: "msgByUserId",
                select: "name profile_pic",
              },
            },
            {
              path: "replyTo",
              populate: {
                path: "msgByUserId",
                select: "name profile_pic",
              },
            },
          ],
          options: { sort: { createdAt: 1 } },
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
        }).populate({
          path: "messages",
          populate: [
            {
              path: "msgByUserId",
              select: "name profile_pic",
            },
            {
              path: "forwardFrom",
              populate: {
                path: "msgByUserId",
                select: "name profile_pic",
              },
            },
            {
              path: "replyTo",
              populate: {
                path: "msgByUserId",
                select: "name profile_pic",
              },
            },
          ],
          options: { sort: { createdAt: 1 } },
        });

        if (currentConversation) {
          io.to(sender).emit("message", currentConversation.messages || []);
        }

        // Send success notification
        socket.emit("forward-message-success", {
          messageId: saveMessage._id,
          originalMessageId: originalMessage._id,
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

        const contactsWithOnlineStatus = allUsers.map((contact) => ({
          ...contact,
          online: onlineUser.has(contact._id.toString()),
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
          socket.emit("delete-message-error", {
            error: "Conversation not found",
          });
          return;
        }

        // Kiểm tra người dùng có trong cuộc trò chuyện
        const isUserInConversation =
          conversation.sender.toString() === userId.toString() ||
          conversation.receiver.toString() === userId.toString();

        if (!isUserInConversation) {
          socket.emit("delete-message-error", {
            error: "User not in conversation",
          });
          return;
        }

        // Thêm tin nhắn vào danh sách đã xóa của người dùng
        await UserModel.findByIdAndUpdate(userId, {
          $addToSet: { deletedMessages: messageId },
        });

        // Gửi thông báo xóa tin nhắn thành công cho người gửi
        socket.emit("delete-message-success", { messageId });

        // Lấy danh sách tin nhắn đã xóa của người dùng
        const user = await UserModel.findById(userId);
        const deletedMessages = user.deletedMessages || [];

        // Lấy danh sách tin nhắn đã cập nhật cho người xóa
        const updatedConversation = await ConversationModel.findById(
          conversationId
        ).populate({
          path: "messages",
          match: { _id: { $nin: deletedMessages } }, // Lọc tất cả tin nhắn đã xóa
          populate: [
            {
              path: "msgByUserId",
              select: "name profile_pic",
            },
            {
              path: "replyTo",
              populate: {
                path: "msgByUserId",
                select: "name profile_pic",
              },
            },
          ],
          options: { sort: { createdAt: 1 } },
        });

        // Đảm bảo trạng thái isRecalled được giữ nguyên
        const processedMessages = updatedConversation.messages.map((msg) => {
          const messageObj = msg.toObject();
          if (messageObj._id.toString() === messageId) {
            messageObj.isRecalled = true;
          }
          return messageObj;
        });

        // Chỉ gửi tin nhắn cập nhật cho người xóa
        io.to(userId).emit("message", processedMessages || []);
      } catch (error) {
        console.error("Error deleting message:", error);
        socket.emit("delete-message-error", { error: error.message });
      }
    });

    // Handle message reactions
    socket.on("react_to_message", async (data) => {
      try {
        const {
          messageId,
          emoji,
          userId,
          isGroupChat,
          groupId,
          conversationId,
        } = data;
        console.log("Handling reaction:", {
          messageId,
          emoji,
          userId,
          isGroupChat,
          groupId,
        });

        // Validate input
        if (!messageId || !emoji || !userId) {
          socket.emit("error", "Thiếu thông tin reaction");
          return;
        }

        // Tìm và cập nhật tin nhắn
        let message = await MessageModel.findById(messageId).populate(
          "msgByUserId",
          "name profile_pic"
        );

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
          (r) => r.userId.toString() === userId.toString()
        );

        if (existingReactionIndex > -1) {
          // Nếu đã có reaction thì cập nhật emoji
          if (message.reactions[existingReactionIndex].emoji === emoji) {
            // Nếu emoji giống nhau, xóa reaction
            message.reactions.splice(existingReactionIndex, 1);
          } else {
            // Nếu emoji khác, cập nhật emoji mới
            message.reactions[existingReactionIndex].emoji = emoji;
          }
        } else {
          // Thêm reaction mới
          message.reactions.push({
            emoji,
            userId,
          });
        }

        // Lưu tin nhắn đã cập nhật
        await message.save();

        // Chuẩn bị dữ liệu reaction để gửi về client
        const reactionUpdate = {
          messageId: message._id.toString(),
          reactions: message.reactions,
          groupId: isGroupChat ? groupId : null, // Thêm groupId nếu là group chat
        };

        if (isGroupChat) {
          // Nếu là tin nhắn nhóm
          const group = await GroupChatModel.findById(groupId).populate(
            "members",
            "name profile_pic"
          );

          if (!group) {
            console.error("Group not found:", groupId);
            return;
          }

          // Gửi cập nhật cho tất cả thành viên trong nhóm
          group.members.forEach((member) => {
            if (onlineUser.has(member._id.toString())) {
              io.to(member._id.toString()).emit(
                "group-reaction-updated",
                reactionUpdate
              );
            }
          });

          // Cập nhật lại tin nhắn trong group
          const updatedMessage = await MessageModel.findById(messageId)
            .populate("msgByUserId", "name profile_pic")
            .populate({
              path: "replyTo",
              populate: {
                path: "msgByUserId",
                select: "name profile_pic",
              },
            });

          // Gửi tin nhắn đã cập nhật cho tất cả thành viên
          group.members.forEach((member) => {
            if (onlineUser.has(member._id.toString())) {
              io.to(member._id.toString()).emit("update-group-message", {
                ...updatedMessage.toObject(),
                groupId,
              });
            }
          });
        } else {
          // Nếu là tin nhắn cá nhân
          const conversation = await ConversationModel.findById(conversationId);
          if (conversation) {
            io.to(conversation.sender.toString()).emit(
              "reaction-updated",
              reactionUpdate
            );
            io.to(conversation.receiver.toString()).emit(
              "reaction-updated",
              reactionUpdate
            );
          }
        }

        // Gửi phản hồi thành công cho người thực hiện reaction
        socket.emit("reaction-success", reactionUpdate);
      } catch (error) {
        console.error("Lỗi khi xử lý reaction:", error);
        socket.emit("error", "Không thể thêm reaction");
      }
    });

    // Handle reaction removal for private chats
    socket.on("remove-reaction", async (removeData) => {
      try {
        const {
          messageId: msgId,
          userId: uid,
          conversationId: convId,
        } = removeData;

        // Validate input
        if (!msgId || !uid) {
          socket.emit("error", "Thiếu thông tin để xóa reaction");
          return;
        }

        // Tìm và cập nhật tin nhắn
        let message = await MessageModel.findById(msgId);
        if (!message) {
          socket.emit("error", "Không tìm thấy tin nhắn");
          return;
        }

        // Xóa reaction của user
        message.reactions = message.reactions.filter(
          (r) => r.userId.toString() !== uid.toString()
        );
        await message.save();

        // Chuẩn bị dữ liệu để gửi về client
        const reactionUpdate = {
          messageId: message._id.toString(),
          reactions: message.reactions,
        };

        // Gửi cập nhật cho các user trong cuộc trò chuyện
        const conversation = await ConversationModel.findById(convId);
        if (conversation) {
          io.to(conversation.sender.toString()).emit(
            "reaction-updated",
            reactionUpdate
          );
          io.to(conversation.receiver.toString()).emit(
            "reaction-updated",
            reactionUpdate
          );
        }
      } catch (error) {
        console.error("Lỗi khi xóa reaction:", error);
        socket.emit("error", "Không thể xóa reaction");
      }
    });

    // Handle reaction removal for group chats
    socket.on("remove-group-reaction", async (groupData) => {
      try {
        const { messageId: msgId, userId: uid, groupId: gid } = groupData;

        // Validate input
        if (!msgId || !uid || !gid) {
          socket.emit("error", "Thiếu thông tin để xóa reaction");
          return;
        }

        // Tìm và cập nhật tin nhắn
        let message = await MessageModel.findById(msgId);
        if (!message) {
          socket.emit("error", "Không tìm thấy tin nhắn");
          return;
        }

        // Xóa reaction của user
        message.reactions = message.reactions.filter(
          (r) => r.userId.toString() !== uid.toString()
        );
        await message.save();

        // Chuẩn bị dữ liệu để gửi về client
        const reactionUpdate = {
          messageId: message._id.toString(),
          reactions: message.reactions,
        };

        // Gửi cập nhật cho tất cả thành viên trong nhóm
        const group = await GroupChatModel.findById(gid);
        if (group) {
          group.members.forEach((memberId) => {
            if (onlineUser.has(memberId.toString())) {
              io.to(memberId.toString()).emit(
                "reaction-updated",
                reactionUpdate
              );
            }
          });
        }
      } catch (error) {
        console.error("Lỗi khi xóa reaction trong nhóm:", error);
        socket.emit("error", "Không thể xóa reaction");
      }
    });

    // Handle message search
    socket.on("search-messages", async (data) => {
      try {
        const { search, conversationId, groupId, currentUserId, isGroupChat } =
          data;
        console.log("Received search request:", {
          search,
          conversationId,
          groupId,
          currentUserId,
          isGroupChat,
        });

        let messages = [];
        const searchRegex = new RegExp(search, "i");

        if (isGroupChat) {
          // Tìm kiếm trong chat nhóm
          const group = await GroupChatModel.findById(groupId).populate({
            path: "messages",
            populate: [
              {
                path: "msgByUserId",
                select: "name profile_pic",
              },
              {
                path: "replyTo",
                populate: {
                  path: "msgByUserId",
                  select: "name profile_pic",
                },
              },
            ],
          });

          if (!group) {
            console.log("Group not found:", groupId);
            socket.emit("search-messages-error", {
              message: "Group not found",
            });
            return;
          }

          // Kiểm tra user có phải là thành viên của nhóm
          if (!group.members.includes(currentUserId)) {
            console.log("User not in group:", currentUserId);
            socket.emit("search-messages-error", {
              message: "You don't have access to this group",
            });
            return;
          }

          // Tìm kiếm tin nhắn trong mảng messages của nhóm
          messages = await MessageModel.find({
            _id: { $in: group.messages },
            isRecalled: { $ne: true },
            $or: [
              { text: { $regex: searchRegex } },
              { imageUrl: { $regex: searchRegex } },
              { videoUrl: { $regex: searchRegex } },
              { fileName: { $regex: searchRegex } },
            ],
          })
            .populate({
              path: "msgByUserId",
              select: "name profile_pic",
            })
            .populate({
              path: "replyTo",
              populate: {
                path: "msgByUserId",
                select: "name profile_pic",
              },
            })
            .sort({ createdAt: -1 });
        } else {
          // Tìm kiếm trong chat đơn
          const conversation = await ConversationModel.findById(conversationId);
          if (!conversation) {
            console.log("Conversation not found:", conversationId);
            socket.emit("search-messages-error", {
              message: "Conversation not found",
            });
            return;
          }

          // Kiểm tra user có quyền truy cập conversation
          if (
            conversation.sender.toString() !== currentUserId &&
            conversation.receiver.toString() !== currentUserId
          ) {
            console.log("User not in conversation:", currentUserId);
            socket.emit("search-messages-error", {
              message: "You don't have access to this conversation",
            });
            return;
          }

          // Tìm kiếm tin nhắn trong chat đơn
          messages = await MessageModel.find({
            _id: { $in: conversation.messages },
            isRecalled: { $ne: true },
            $or: [
              { text: { $regex: searchRegex } },
              { imageUrl: { $regex: searchRegex } },
              { videoUrl: { $regex: searchRegex } },
              { fileName: { $regex: searchRegex } },
            ],
          })
            .populate({
              path: "msgByUserId",
              select: "name profile_pic",
            })
            .populate({
              path: "replyTo",
              populate: {
                path: "msgByUserId",
                select: "name profile_pic",
              },
            })
            .sort({ createdAt: -1 });
        }

        console.log("Found messages:", messages.length);

        // Lấy danh sách tin nhắn đã xóa của người dùng
        const user = await UserModel.findById(currentUserId);
        const deletedMessages = user.deletedMessages || [];

        // Lọc bỏ tin nhắn đã xóa khỏi kết quả tìm kiếm
        const filteredMessages = messages.filter(
          (msg) => !deletedMessages.includes(msg._id.toString())
        );

        // Format kết quả
        const formattedMessages = filteredMessages.map((msg) => ({
          _id: msg._id,
          text: msg.text,
          imageUrl: msg.imageUrl,
          videoUrl: msg.videoUrl,
          fileUrl: msg.fileUrl,
          fileName: msg.fileName,
          msgByUserId: {
            _id: msg.msgByUserId._id,
            name: msg.msgByUserId.name,
            profile_pic: msg.msgByUserId.profile_pic,
          },
          replyTo: msg.replyTo,
          createdAt: msg.createdAt,
          seen: msg.seen,
          reactions: msg.reactions || [],
          forwardFrom: msg.forwardFrom,
          isRecalled: msg.isRecalled,
        }));

        socket.emit("search-messages-result", {
          success: true,
          data: formattedMessages,
        });
      } catch (error) {
        console.error("Error in search-messages socket:", error);
        socket.emit("search-messages-error", {
          message: "Error searching messages",
          error: error.message,
        });
      }
    });

    // Handle unfriend request
    socket.on("unfriend", async (data) => {
      try {
        const { targetUserId } = data;
        const currentUserId = user._id; // Use the authenticated user's ID

        // Find both users
        const currentUser = await UserModel.findById(currentUserId);
        const targetUser = await UserModel.findById(targetUserId);

        if (!currentUser || !targetUser) {
          socket.emit("error", "Người dùng không tồn tại");
          return;
        }

        // Check if they are actually friends
        const areFriends =
          currentUser.friends.includes(targetUserId) &&
          targetUser.friends.includes(currentUserId);

        if (!areFriends) {
          socket.emit("error", "Các bạn chưa là bạn bè");
          return;
        }

        // Update friendship status in database for both users
        await UserModel.findByIdAndUpdate(currentUserId, {
          $pull: { friends: targetUserId },
        });

        await UserModel.findByIdAndUpdate(targetUserId, {
          $pull: { friends: currentUserId },
        });

        // Emit to the user who initiated the unfriend
        socket.emit("unfriend-success", {
          targetUserId: targetUserId,
        });

        // Emit to the user who was unfriended
        if (onlineUser.has(targetUserId.toString())) {
          io.to(targetUserId.toString()).emit("unfriend-received", {
            targetUserId: currentUserId,
          });
        }
      } catch (error) {
        console.error("Error in unfriend:", error);
        socket.emit("error", "Không thể hủy kết bạn");
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
          _id: { $in: currentUser.friends },
        }).select("name profile_pic _id");

        const friendsWithOnlineStatus = friends.map((friend) => ({
          ...friend.toObject(),
          online: onlineUser.has(friend._id.toString()),
        }));

        socket.emit("friends", friendsWithOnlineStatus);
      } catch (error) {
        console.error("Error getting friends list:", error);
        socket.emit("error", "Could not get friends list");
      }
    });

    // Thêm handler cho get-user-groups
    socket.on("get-user-groups", async () => {
      try {
        // Tìm tất cả các nhóm mà user là thành viên hoặc người tạo
        const userGroups = await GroupChatModel.find({
          $or: [{ members: user._id }, { creator: user._id }],
        })
          .populate("members", "name profile_pic")
          .populate("creator", "name profile_pic")
          .populate("lastMessage");

        socket.emit("user-groups", userGroups);
      } catch (error) {
        console.error("Error getting user groups:", error);
        socket.emit("error", "Không thể lấy danh sách nhóm");
      }
    });

    // Handle recall message
    socket.on("recall-message", async (data) => {
      try {
        const { messageId, userId, conversationId, isGroup, groupId } = data;
        const message = await MessageModel.findById(messageId);

        if (!message) {
          socket.emit("recall-message-error", { error: "Message not found" });
          return;
        }

        // Kiểm tra xem người dùng có phải là người gửi tin nhắn không
        if (message.msgByUserId.toString() !== userId) {
          socket.emit("recall-message-error", {
            error: "You can only recall your own messages",
          });
          return;
        }

        if (isGroup) {
          // Xử lý thu hồi tin nhắn trong nhóm
          const group = await GroupChatModel.findById(groupId);
          if (!group) {
            socket.emit("recall-message-error", { error: "Group not found" });
            return;
          }

          // Kiểm tra người dùng có trong nhóm không
          if (!group.members.includes(userId)) {
            socket.emit("recall-message-error", {
              error: "You are not a member of this group",
            });
            return;
          }

          // Đánh dấu tin nhắn đã thu hồi
          message.isRecalled = true;
          await message.save();

          // Lấy danh sách tin nhắn đã cập nhật
          const updatedMessages = await MessageModel.find({
            _id: { $in: group.messages },
          })
            .populate("msgByUserId", "name profile_pic")
            .populate({
              path: "replyTo",
              populate: {
                path: "msgByUserId",
                select: "name profile_pic",
              },
            })
            .sort({ createdAt: 1 });

          // Gửi thông báo thu hồi tin nhắn cho tất cả thành viên trong nhóm
          group.members.forEach((memberId) => {
            if (onlineUser.has(memberId.toString())) {
              // Gửi sự kiện thu hồi tin nhắn
              io.to(memberId.toString()).emit("recall-message-success", {
                messageId,
                groupId,
              });

              // Gửi lại danh sách tin nhắn đã cập nhật
              io.to(memberId.toString()).emit(
                "group-messages",
                updatedMessages
              );
            }
          });

          // Cập nhật lastMessage nếu tin nhắn bị thu hồi là tin nhắn cuối cùng
          if (group.lastMessage.toString() === messageId) {
            // Tìm tin nhắn cuối cùng không bị thu hồi
            const lastValidMessage = await MessageModel.findOne({
              _id: { $in: group.messages },
              isRecalled: { $ne: true },
            }).sort({ createdAt: -1 });

            if (lastValidMessage) {
              group.lastMessage = lastValidMessage._id;
            }
            await group.save();

            // Cập nhật danh sách nhóm cho tất cả thành viên
            for (const memberId of group.members) {
              if (onlineUser.has(memberId.toString())) {
                const userGroups = await GroupChatModel.find({
                  members: memberId,
                })
                  .populate("members", "name profile_pic")
                  .populate("creator", "name profile_pic")
                  .populate("lastMessage");

                io.to(memberId.toString()).emit("user-groups", userGroups);
              }
            }
          }
        } else {
          // Xử lý thu hồi tin nhắn trong chat đơn (giữ nguyên code cũ)
          const conversation = await ConversationModel.findById(conversationId);
          if (!conversation) {
            socket.emit("recall-message-error", {
              error: "Conversation not found",
            });
            return;
          }

          const isUserInConversation =
            conversation.sender.toString() === userId.toString() ||
            conversation.receiver.toString() === userId.toString();

          if (!isUserInConversation) {
            socket.emit("recall-message-error", {
              error: "User not in conversation",
            });
            return;
          }

          message.isRecalled = true;
          await message.save();

          io.to(conversation.sender.toString()).emit("recall-message-success", {
            messageId,
          });
          io.to(conversation.receiver.toString()).emit(
            "recall-message-success",
            {
              messageId,
            }
          );

          const updatedConversation = await ConversationModel.findById(
            conversationId
          ).populate({
            path: "messages",
            populate: [
              {
                path: "msgByUserId",
                select: "name profile_pic",
              },
              {
                path: "replyTo",
                populate: {
                  path: "msgByUserId",
                  select: "name profile_pic",
                },
              },
            ],
            options: { sort: { createdAt: 1 } },
          });

          const processedMessages = updatedConversation.messages.map((msg) => {
            const messageObj = msg.toObject();
            if (messageObj._id.toString() === messageId) {
              messageObj.isRecalled = true;
            }
            return messageObj;
          });

          io.to(conversation.sender.toString()).emit(
            "message",
            processedMessages || []
          );
          io.to(conversation.receiver.toString()).emit(
            "message",
            processedMessages || []
          );
        }
      } catch (error) {
        console.error("Error recalling message:", error);
        socket.emit("recall-message-error", { error: error.message });
      }
    });

    // Handle create group
    socket.on("create-group", async (data) => {
      try {
        const { name, members, creator } = data;

        // Validate input
        if (!name || !members || !members.length || !creator) {
          socket.emit("error", "Thiếu thông tin cần thiết để tạo nhóm");
          return;
        }

        // Kiểm tra xem người tạo có tồn tại không
        const creatorUser = await UserModel.findById(creator);
        if (!creatorUser) {
          socket.emit("error", "Không tìm thấy người tạo nhóm");
          return;
        }

        // Kiểm tra các thành viên có tồn tại không
        const memberUsers = await UserModel.find({ _id: { $in: members } });
        if (memberUsers.length !== members.length) {
          socket.emit("error", "Một số thành viên không tồn tại");
          return;
        }

        // Tạo nhóm mới
        const newGroup = new GroupChatModel({
          name,
          creator,
          members: [...members, creator], // Thêm người tạo vào danh sách thành viên
          isGroup: true,
        });

        await newGroup.save();

        // Populate thông tin chi tiết của group
        const populatedGroup = await GroupChatModel.findById(newGroup._id)
          .populate("members", "name profile_pic")
          .populate("creator", "name profile_pic");

        // Thông báo cho tất cả thành viên về nhóm mới
        const allMembers = [...members, creator];
        allMembers.forEach((memberId) => {
          if (onlineUser.has(memberId.toString())) {
            io.to(memberId.toString()).emit("new-group", populatedGroup);
          }
        });

        // Thông báo thành công cho người tạo
        socket.emit("group-created", {
          success: true,
          group: populatedGroup,
        });
      } catch (error) {
        console.error("Error creating group:", error);
        socket.emit("error", "Có lỗi xảy ra khi tạo nhóm");
      }
    });

    // Handle get group messages
    socket.on("get-group-messages", async (groupId) => {
      try {
        console.log("Getting messages for group:", groupId);

        // Kiểm tra group có tồn tại không
        const group = await GroupChatModel.findById(groupId).populate({
          path: "messages",
          populate: [
            {
              path: "msgByUserId",
              select: "name profile_pic",
            },
            {
              path: "replyTo",
              populate: {
                path: "msgByUserId",
                select: "name profile_pic",
              },
            },
          ],
          options: { sort: { createdAt: 1 } },
        });

        if (!group) {
          socket.emit("error", "Không tìm thấy nhóm");
          return;
        }

        // Kiểm tra người dùng có trong nhóm không
        if (!group.members.includes(user._id)) {
          socket.emit("error", "Bạn không phải thành viên của nhóm");
          return;
        }

        // Reset số tin nhắn chưa đọc cho người dùng khi mở chat
        const memberUnseenIndex = group.unseenMessages.findIndex(
          (um) => um.userId.toString() === user._id.toString()
        );

        if (memberUnseenIndex !== -1) {
          // Đặt lại số tin nhắn chưa đọc về 0
          group.unseenMessages[memberUnseenIndex].count = 0;
          group.unseenMessages[memberUnseenIndex].lastSeenMessage =
            group.messages[group.messages.length - 1];
          await group.save();

          // Lấy tất cả nhóm của người dùng và cập nhật UI
          const userGroups = await GroupChatModel.find({
            members: user._id,
          })
            .populate("members", "name profile_pic")
            .populate("creator", "name profile_pic")
            .populate("lastMessage");

          // Sắp xếp nhóm theo thời gian tin nhắn cuối cùng
          const sortedGroups = userGroups.sort((a, b) => {
            const aTime = a.lastMessage?.createdAt || a.createdAt;
            const bTime = b.lastMessage?.createdAt || b.createdAt;
            return new Date(bTime) - new Date(aTime);
          });

          // Gửi hai sự kiện để đảm bảo cả sidebar và danh sách nhóm được cập nhật
          io.to(user._id.toString()).emit("user-groups", sortedGroups);

          // Gửi sự kiện cập nhật trạng thái đã xem
          io.to(user._id.toString()).emit("group-messages-seen", {
            groupId: groupId,
            userId: user._id.toString(),
          });
        }

        console.log("Found messages for group:", {
          groupId,
          count: group.messages?.length || 0,
          sample: group.messages?.[0]
            ? {
                id: group.messages[0]._id,
                text: group.messages[0].text,
                sender: group.messages[0].msgByUserId?.name,
              }
            : null,
        });

        socket.emit("group-messages", group.messages || []);

        // Emit seen-group-message event to update the UI immediately
        socket.emit("seen-group-message-success", {
          groupId: groupId,
          userId: user._id.toString(),
        });
      } catch (error) {
        console.error("Error getting group messages:", error);
        socket.emit("error", "Có lỗi xảy ra khi lấy tin nhắn nhóm");
      }
    });

    // Handle group message
    socket.on("group-message", async (data) => {
      try {
        console.log("Received group message data:", data);
        const {
          groupId,
          text,
          sender,
          imageUrl,
          videoUrl,
          fileUrl,
          fileName,
          replyTo,
          msgByUserId,
        } = data;

        // Validate input
        if (!groupId || !sender) {
          socket.emit("error", "Thiếu thông tin cần thiết");
          return;
        }

        // Kiểm tra group có tồn tại không
        const group = await GroupChatModel.findById(groupId);
        if (!group) {
          socket.emit("error", "Không tìm thấy nhóm");
          return;
        }

        // Kiểm tra người gửi có trong nhóm không
        const isMember = group.members.includes(sender);
        if (!isMember) {
          socket.emit("error", "Bạn không phải thành viên của nhóm");
          return;
        }

        // Tạo tin nhắn mới
        const newMessage = new MessageModel({
          text,
          imageUrl,
          videoUrl,
          fileUrl,
          fileName,
          msgByUserId: sender,
          replyTo,
          groupId: groupId,
          isGroupMessage: true,
          createdAt: new Date(),
          reactions: [],
        });

        const savedMessage = await newMessage.save();

        // Lấy tin nhắn đã lưu với đầy đủ thông tin
        const populatedMessage = await MessageModel.findById(savedMessage._id)
          .populate("msgByUserId", "name profile_pic")
          .populate({
            path: "replyTo",
            populate: {
              path: "msgByUserId",
              select: "name profile_pic",
            },
          });

        // Cập nhật tin nhắn cuối cùng và thêm tin nhắn mới vào nhóm
        group.lastMessage = savedMessage._id;
        group.messages.push(savedMessage._id);

        // Cập nhật số tin nhắn chưa đọc cho các thành viên khác
        group.members.forEach((memberId) => {
          if (memberId.toString() !== sender.toString()) {
            // Chỉ tăng số tin nhắn chưa đọc cho những người không đang xem chat
            const memberSocket = Array.from(io.sockets.sockets.values()).find(
              (s) => {
                try {
                  if (!s.handshake?.auth?.token) return false;
                  const socketUser = getUserDetailFromToken(
                    s.handshake.auth.token
                  );
                  return (
                    socketUser &&
                    socketUser._id.toString() === memberId.toString()
                  );
                } catch (error) {
                  console.error("Error checking socket user:", error);
                  return false;
                }
              }
            );

            const isViewingChat = memberSocket?.viewingChat === groupId;

            if (!isViewingChat) {
              const memberUnseenIndex = group.unseenMessages.findIndex(
                (um) => um.userId.toString() === memberId.toString()
              );

              if (memberUnseenIndex !== -1) {
                group.unseenMessages[memberUnseenIndex].count += 1;
              } else {
                group.unseenMessages.push({
                  userId: memberId,
                  count: 1,
                  lastSeenMessage: group.messages[group.messages.length - 2], // tin nhắn trước tin nhắn mới
                });
              }
            }
          }
        });

        await group.save();

        // Chuẩn bị dữ liệu tin nhắn để gửi
        const messageToSend = {
          ...populatedMessage.toObject(),
          groupId: groupId,
        };

        // Gửi tin nhắn đến tất cả thành viên trong nhóm
        group.members.forEach((memberId) => {
          if (onlineUser.has(memberId.toString())) {
            io.to(memberId.toString()).emit("group-message", messageToSend);
          }
        });

        // Lấy danh sách nhóm đã cập nhật cho từng thành viên
        const updatedGroup = await GroupChatModel.findById(groupId)
          .populate("members", "name profile_pic")
          .populate("creator", "name profile_pic")
          .populate("lastMessage");

        // Gửi cập nhật cho từng thành viên
        for (const memberId of group.members) {
          if (onlineUser.has(memberId.toString())) {
            // Lấy tất cả nhóm của thành viên
            const userGroups = await GroupChatModel.find({
              members: memberId,
            })
              .populate("members", "name profile_pic")
              .populate("creator", "name profile_pic")
              .populate("lastMessage");

            // Sắp xếp nhóm theo thời gian tin nhắn cuối cùng
            const sortedGroups = userGroups.sort((a, b) => {
              const aTime = a.lastMessage?.createdAt || a.createdAt;
              const bTime = b.lastMessage?.createdAt || b.createdAt;
              return new Date(bTime) - new Date(aTime);
            });

            io.to(memberId.toString()).emit("user-groups", sortedGroups);
          }
        }
      } catch (error) {
        console.error("Error sending group message:", error);
        socket.emit("error", "Có lỗi xảy ra khi gửi tin nhắn");
      }
    });

    // Thêm event handler để theo dõi chat đang mở
    socket.on("viewing-chat", async (data) => {
      try {
        const { chatId, isGroup } = data;
        socket.viewingChat = chatId;

        if (isGroup) {
          // Reset số tin nhắn chưa đọc khi mở chat nhóm
          await GroupChatModel.updateOne(
            {
              _id: chatId,
              "unseenMessages.userId": user._id,
            },
            {
              $set: {
                "unseenMessages.$.count": 0,
              },
            }
          );

          // Cập nhật lại danh sách nhóm
          const userGroups = await GroupChatModel.find({
            members: user._id,
          })
            .populate("members", "name profile_pic")
            .populate("creator", "name profile_pic")
            .populate("lastMessage");

          const sortedGroups = userGroups.sort((a, b) => {
            const aTime = a.lastMessage?.createdAt || a.createdAt;
            const bTime = b.lastMessage?.createdAt || b.createdAt;
            return new Date(bTime) - new Date(aTime);
          });

          io.to(user._id.toString()).emit("user-groups", sortedGroups);
        }
      } catch (error) {
        console.error("Error updating viewing chat status:", error);
      }
    });

    socket.on("leave-chat", () => {
      socket.viewingChat = null;
    });

    // Handle seen group message
    socket.on("seen-group-message", async (data) => {
      try {
        const { groupId, userId } = data;

        const group = await GroupChatModel.findById(groupId);
        if (!group) {
          socket.emit("error", "Không tìm thấy nhóm");
          return;
        }

        // Kiểm tra người dùng có trong nhóm không
        if (!group.members.includes(userId)) {
          socket.emit("error", "Bạn không phải thành viên của nhóm");
          return;
        }

        // Reset số tin nhắn chưa đọc cho người dùng
        const memberUnseenIndex = group.unseenMessages.findIndex(
          (um) => um.userId.toString() === userId.toString()
        );

        if (memberUnseenIndex !== -1) {
          group.unseenMessages[memberUnseenIndex].count = 0;
          group.unseenMessages[memberUnseenIndex].lastSeenMessage =
            group.messages[group.messages.length - 1];
        }

        await group.save();

        // Lấy tất cả nhóm của người dùng
        const userGroups = await GroupChatModel.find({
          members: userId,
        })
          .populate("members", "name profile_pic")
          .populate("creator", "name profile_pic")
          .populate("lastMessage");

        // Sắp xếp nhóm theo thời gian tin nhắn cuối cùng
        const sortedGroups = userGroups.sort((a, b) => {
          const aTime = a.lastMessage?.createdAt || a.createdAt;
          const bTime = b.lastMessage?.createdAt || b.createdAt;
          return new Date(bTime) - new Date(aTime);
        });

        // Gửi lại danh sách nhóm đã cập nhật cho người dùng
        io.to(userId.toString()).emit("user-groups", sortedGroups);
      } catch (error) {
        console.error("Error marking group messages as seen:", error);
        socket.emit("error", "Có lỗi xảy ra khi đánh dấu đã xem");
      }
    });

    // Handle get group info
    socket.on("get-group-info", async (groupId) => {
      try {
        console.log("Getting group info for:", groupId); // Debug log

        // Kiểm tra group có tồn tại không
        const group = await GroupChatModel.findById(groupId)
          .populate("members", "name profile_pic")
          .populate("creator", "name profile_pic");

        console.log("Found group:", group); // Debug log

        if (!group) {
          socket.emit("error", "Không tìm thấy nhóm");
          return;
        }

        // Kiểm tra người dùng có trong nhóm không
        const isMember = group.members.some(
          (member) => member._id.toString() === user._id.toString()
        );

        if (!isMember) {
          socket.emit("error", "Bạn không phải thành viên của nhóm");
          return;
        }

        // Gửi thông tin nhóm
        const groupInfo = {
          _id: group._id,
          name: group.name,
          avatar: group.avatar || "", // Thêm giá trị mặc định nếu không có avatar
          members: group.members.map((member) => ({
            _id: member._id,
            name: member.name,
            profile_pic: member.profile_pic,
          })),
          creator: {
            _id: group.creator._id,
            name: group.creator.name,
            profile_pic: group.creator.profile_pic,
          },
          isGroup: true,
        };

        console.log("Emitting group info:", groupInfo); // Debug log
        socket.emit("group-info", groupInfo);
      } catch (error) {
        console.error("Error getting group info:", error);
        socket.emit("error", "Có lỗi xảy ra khi lấy thông tin nhóm");
      }
    });

    // Xử lý xóa nhóm
    socket.on("delete-group", async (data) => {
      try {
        const { groupId, userId } = data;

        // Kiểm tra nhóm tồn tại
        const group = await GroupChatModel.findById(groupId);
        if (!group) {
          socket.emit("group-deleted", {
            success: false,
            message: "Không tìm thấy nhóm",
          });
          return;
        }

        // Kiểm tra quyền xóa nhóm
        if (group.creator.toString() !== userId) {
          socket.emit("group-deleted", {
            success: false,
            message: "Bạn không có quyền xóa nhóm này",
          });
          return;
        }

        // Xóa nhóm
        await GroupChatModel.findByIdAndDelete(groupId);

        // Thông báo cho tất cả thành viên trong nhóm
        group.members.forEach((memberId) => {
          if (onlineUser.has(memberId.toString())) {
            io.to(memberId.toString()).emit("group-deleted", {
              success: true,
              groupId: groupId,
            });

            // Cập nhật lại danh sách nhóm cho thành viên
            io.to(memberId.toString()).emit("get-user-groups");
          }
        });
      } catch (error) {
        console.error("Error deleting group:", error);
        socket.emit("group-deleted", {
          success: false,
          message: "Có lỗi xảy ra khi xóa nhóm",
        });
      }
    });

    // Handle leave group
    socket.on("leave-group", async (data) => {
      try {
        const { groupId, userId } = data;

        // Kiểm tra nhóm tồn tại
        const group = await GroupChatModel.findById(groupId)
          .populate("members", "name profile_pic")
          .populate("creator", "name profile_pic");

        if (!group) {
          socket.emit("leave-group-error", {
            message: "Không tìm thấy nhóm",
          });
          return;
        }

        // Kiểm tra người dùng có trong nhóm không
        if (!group.members.some((member) => member._id.toString() === userId)) {
          socket.emit("leave-group-error", {
            message: "Bạn không phải thành viên của nhóm",
          });
          return;
        }

        // Không cho phép người tạo nhóm rời nhóm
        if (group.creator._id.toString() === userId) {
          socket.emit("leave-group-error", {
            message:
              "Người tạo nhóm không thể rời nhóm. Bạn có thể xóa nhóm nếu muốn.",
          });
          return;
        }

        // Lấy thông tin người rời nhóm
        const leavingUser = await UserModel.findById(userId);

        // Xóa người dùng khỏi danh sách thành viên
        await GroupChatModel.findByIdAndUpdate(groupId, {
          $pull: {
            members: userId,
            unseenMessages: { userId: userId },
          },
        });

        // Tạo tin nhắn hệ thống
        const systemMessage = new MessageModel({
          text: `${leavingUser.name} đã rời khỏi nhóm`,
          msgByUserId: userId,
          groupId: groupId,
          isGroupMessage: true,
          isSystemMessage: true,
          createdAt: new Date(),
        });

        const savedMessage = await systemMessage.save();

        // Cập nhật tin nhắn vào nhóm
        await GroupChatModel.findByIdAndUpdate(groupId, {
          $push: { messages: savedMessage._id },
          lastMessage: savedMessage._id,
        });

        // Lấy thông tin nhóm đã cập nhật
        const updatedGroup = await GroupChatModel.findById(groupId)
          .populate("members", "name profile_pic")
          .populate("creator", "name profile_pic")
          .populate("lastMessage");

        // Thông báo cho người rời nhóm
        socket.emit("leave-group-success", {
          groupId: groupId,
          systemMessage: savedMessage,
          userId: userId,
        });

        // Thông báo cho các thành viên còn lại
        updatedGroup.members.forEach((member) => {
          if (onlineUser.has(member._id.toString())) {
            // Gửi tin nhắn hệ thống
            io.to(member._id.toString()).emit("group-message", {
              ...savedMessage.toObject(),
              msgByUserId: {
                _id: userId,
                name: leavingUser.name,
                profile_pic: leavingUser.profile_pic,
              },
            });

            // Cập nhật thông tin nhóm
            io.to(member._id.toString()).emit("group-info", {
              _id: updatedGroup._id,
              name: updatedGroup.name,
              avatar: updatedGroup.avatar || "",
              members: updatedGroup.members,
              creator: updatedGroup.creator,
              isGroup: true,
            });

            // Cập nhật danh sách nhóm
            io.to(member._id.toString()).emit("get-user-groups");
          }
        });
      } catch (error) {
        console.error("Error leaving group:", error);
        socket.emit("leave-group-error", {
          message: "Có lỗi xảy ra khi rời nhóm",
        });
      }
    });

    // Handle add members to group
    socket.on("add-members-to-group", async (data) => {
      try {
        const { groupId, newMembers, addedBy, groupName, currentMembers } =
          data;

        // Kiểm tra nhóm tồn tại
        const group = await GroupChatModel.findById(groupId)
          .populate("members", "name profile_pic")
          .populate("creator", "name profile_pic");

        if (!group) {
          socket.emit("add-members-error", {
            message: "Không tìm thấy nhóm",
          });
          return;
        }

        // Kiểm tra người thêm có trong nhóm không
        if (
          !group.members.some((member) => member._id.toString() === addedBy)
        ) {
          socket.emit("add-members-error", {
            message: "Bạn không phải thành viên của nhóm này",
          });
          return;
        }

        // Lọc ra những thành viên chưa có trong nhóm
        const validNewMembers = newMembers.filter(
          (memberId) =>
            !group.members.some(
              (existingMember) => existingMember._id.toString() === memberId
            )
        );

        if (validNewMembers.length === 0) {
          socket.emit("add-members-error", {
            message: "Những người này đã là thành viên của nhóm",
          });
          return;
        }

        // Thêm thành viên mới vào nhóm
        await GroupChatModel.findByIdAndUpdate(groupId, {
          $push: {
            members: { $each: validNewMembers },
            unseenMessages: {
              $each: validNewMembers.map((memberId) => ({
                userId: memberId,
                count: 0,
                lastSeenMessage: group.messages[group.messages.length - 1],
              })),
            },
          },
        });

        // Lấy thông tin người thêm
        const adder = await UserModel.findById(addedBy);

        // Lấy thông tin những người được thêm
        const addedUsers = await UserModel.find(
          { _id: { $in: validNewMembers } },
          "name profile_pic"
        );

        // Tạo tin nhắn hệ thống
        const systemMessage = new MessageModel({
          text: `${adder.name} đã thêm ${addedUsers
            .map((u) => u.name)
            .join(", ")} vào nhóm`,
          msgByUserId: addedBy,
          groupId: groupId,
          isGroupMessage: true,
          isSystemMessage: true,
          createdAt: new Date(),
        });

        const savedMessage = await systemMessage.save();

        // Cập nhật tin nhắn vào nhóm
        await GroupChatModel.findByIdAndUpdate(groupId, {
          $push: { messages: savedMessage._id },
          lastMessage: savedMessage._id,
        });

        // Lấy thông tin nhóm đã cập nhật
        const updatedGroup = await GroupChatModel.findById(groupId)
          .populate("members", "name profile_pic")
          .populate("creator", "name profile_pic")
          .populate("lastMessage");

        // Thông báo cho người thêm thành viên
        socket.emit("add-members-success", {
          groupId: groupId,
          systemMessage: savedMessage,
          addedMembers: addedUsers,
        });

        // Thông báo cho tất cả thành viên trong nhóm (cả cũ và mới)
        const allMembers = [
          ...group.members.map((m) => m._id.toString()),
          ...validNewMembers,
        ];

        // Gửi thông báo cho từng thành viên
        for (const memberId of allMembers) {
          if (onlineUser.has(memberId)) {
            // Gửi tin nhắn hệ thống
            io.to(memberId).emit("group-message", {
              ...savedMessage.toObject(),
              msgByUserId: {
                _id: addedBy,
                name: adder.name,
                profile_pic: adder.profile_pic,
              },
            });

            // Cập nhật thông tin nhóm
            io.to(memberId).emit("group-info", {
              _id: updatedGroup._id,
              name: updatedGroup.name,
              avatar: updatedGroup.avatar || "",
              members: updatedGroup.members,
              creator: updatedGroup.creator,
              isGroup: true,
            });

            // Cập nhật danh sách nhóm
            const memberGroups = await GroupChatModel.find({
              members: memberId,
            })
              .populate("members", "name profile_pic")
              .populate("creator", "name profile_pic")
              .populate("lastMessage");

            io.to(memberId).emit("user-groups", memberGroups);
            io.to(memberId).emit("get-user-groups");
          }
        }

        // Gửi thông báo cho những người được thêm
        for (const newMemberId of validNewMembers) {
          if (onlineUser.has(newMemberId)) {
            io.to(newMemberId).emit("new-group", updatedGroup);
          }
        }
      } catch (error) {
        console.error("Error adding members to group:", error);
        socket.emit("add-members-error", {
          message: "Có lỗi xảy ra khi thêm thành viên vào nhóm",
        });
      }
    });

    // Handle kick member from group
    socket.on("kick-member", async (data) => {
      try {
        const { groupId, memberId, adminId } = data;

        // Kiểm tra nhóm tồn tại
        const group = await GroupChatModel.findById(groupId)
          .populate("members", "name profile_pic")
          .populate("creator", "name profile_pic");

        if (!group) {
          socket.emit("kick-member-error", {
            message: "Không tìm thấy nhóm",
          });
          return;
        }

        // Kiểm tra quyền kick thành viên (chỉ admin/creator mới có quyền)
        if (group.creator._id.toString() !== adminId) {
          socket.emit("kick-member-error", {
            message: "Bạn không có quyền xóa thành viên khỏi nhóm",
          });
          return;
        }

        // Kiểm tra thành viên bị kick có trong nhóm không
        if (
          !group.members.some((member) => member._id.toString() === memberId)
        ) {
          socket.emit("kick-member-error", {
            message: "Thành viên này không có trong nhóm",
          });
          return;
        }

        // Không thể kick admin
        if (memberId === group.creator._id.toString()) {
          socket.emit("kick-member-error", {
            message: "Không thể xóa người tạo nhóm",
          });
          return;
        }

        // Lấy thông tin người bị kick
        const kickedUser = await UserModel.findById(memberId);

        // Xóa thành viên khỏi nhóm
        await GroupChatModel.findByIdAndUpdate(groupId, {
          $pull: {
            members: memberId,
            unseenMessages: { userId: memberId },
          },
        });

        // Tạo tin nhắn hệ thống
        const systemMessage = new MessageModel({
          text: `${kickedUser.name} đã bị xóa khỏi nhóm`,
          msgByUserId: adminId,
          groupId: groupId,
          isGroupMessage: true,
          isSystemMessage: true,
          createdAt: new Date(),
        });

        const savedMessage = await systemMessage.save();

        // Cập nhật tin nhắn vào nhóm
        await GroupChatModel.findByIdAndUpdate(groupId, {
          $push: { messages: savedMessage._id },
          lastMessage: savedMessage._id,
        });

        // Lấy thông tin nhóm đã cập nhật
        const updatedGroup = await GroupChatModel.findById(groupId)
          .populate("members", "name profile_pic")
          .populate("creator", "name profile_pic")
          .populate("lastMessage");

        // Thông báo cho người bị kick
        if (onlineUser.has(memberId)) {
          // Gửi thông báo bị kick với thêm thông tin để client xử lý
          io.to(memberId).emit("kicked-from-group", {
            groupId: groupId,
            groupName: group.name,
            shouldExitChat: true, // Thêm flag để client biết cần thoát chat
            message: `Bạn đã bị xóa khỏi nhóm "${group.name}"`,
          });

          // Cập nhật lại danh sách nhóm cho người bị kick
          const kickedUserGroups = await GroupChatModel.find({
            members: memberId,
          })
            .populate("members", "name profile_pic")
            .populate("creator", "name profile_pic")
            .populate("lastMessage");

          io.to(memberId).emit("user-groups", kickedUserGroups);
        }

        // Thông báo cho admin
        socket.emit("kick-member-success", {
          message: "Đã xóa thành viên khỏi nhóm",
        });

        // Thông báo cho các thành viên còn lại
        updatedGroup.members.forEach(async (member) => {
          if (onlineUser.has(member._id.toString())) {
            // Gửi tin nhắn hệ thống
            io.to(member._id.toString()).emit("group-message", {
              ...savedMessage.toObject(),
              msgByUserId: {
                _id: adminId,
                name: user.name,
                profile_pic: user.profile_pic,
              },
            });

            // Cập nhật thông tin nhóm
            io.to(member._id.toString()).emit("group-info", {
              _id: updatedGroup._id,
              name: updatedGroup.name,
              avatar: updatedGroup.avatar || "",
              members: updatedGroup.members,
              creator: updatedGroup.creator,
              isGroup: true,
            });

            // Cập nhật danh sách nhóm
            io.to(member._id.toString()).emit("get-user-groups");
          }
        });
      } catch (error) {
        console.error("Error kicking member from group:", error);
        socket.emit("kick-member-error", {
          message: "Có lỗi xảy ra khi xóa thành viên khỏi nhóm",
        });
      }
    });

    socket.on("transfer-group-ownership", async (data) => {
      try {
        const { groupId, currentOwnerId, newOwnerId } = data;
        const group = await GroupChat.findById(groupId);

        if (!group) {
          socket.emit("transfer-ownership-error", { message: "Nhóm không tồn tại" });
          return;
        }

        if (group.creator.toString() !== currentOwnerId) {
          socket.emit("transfer-ownership-error", { message: "Bạn không phải trưởng nhóm" });
          return;
        }

        if (!group.members.includes(newOwnerId)) {
          socket.emit("transfer-ownership-error", { message: "Người nhận không thuộc nhóm" });
          return;
        }

        group.creator = newOwnerId;
        await group.save();

        socket.emit("transfer-ownership-success", { message: "Chuyển quyền trưởng nhóm thành công" });
        // Gửi thông báo cho các thành viên khác nếu muốn
        socket.to(groupId).emit("group-ownership-changed", { groupId, newOwnerId });

      } catch (err) {
        socket.emit("transfer-ownership-error", { message: "Có lỗi xảy ra khi chuyển quyền" });
      }
    });
  } catch (error) {
    console.error("Socket connection error:", error.message);
    socket.emit("error", { message: "Server error during authentication" });
    socket.disconnect(true);
  }
});

module.exports = {
  app,
  server,
};
