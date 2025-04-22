const UserModel = require("../models/UserModel");

async function sendFriendRequest(request, response) {
  try {
    const { currentUserId, targetUserId } = request.body;

    if (!currentUserId || !targetUserId) {
      return response.status(400).json({
        message: "Both currentUserId and targetUserId are required",
        error: true
      });
    }

    // Check if users exist
    const currentUser = await UserModel.findById(currentUserId);
    const targetUser = await UserModel.findById(targetUserId);

    if (!currentUser || !targetUser) {
      return response.status(404).json({
        message: "User not found",
        error: true
      });
    }

    // Check if already friends
    if (currentUser.friends.includes(targetUserId)) {
      return response.status(400).json({
        message: "Already friends",
        error: true
      });
    }

    // Check if request already exists
    const existingRequest = targetUser.friendRequests.find(
      request => request.from.toString() === currentUserId && request.status === 'pending'
    );

    if (existingRequest) {
      return response.status(400).json({
        message: "Friend request already sent",
        error: true
      });
    }

    // Add friend request
    targetUser.friendRequests.push({
      from: currentUserId,
      status: 'pending'
    });

    await targetUser.save();

    return response.json({
      message: "Friend request sent successfully",
      success: true
    });
  } catch (error) {
    return response.status(500).json({
      message: error.message || "Something went wrong",
      error: true
    });
  }
}

async function handleFriendRequest(request, response) {
  try {
    const { currentUserId, requestId, action } = request.body;

    if (!currentUserId || !requestId || !action) {
      return response.status(400).json({
        message: "All fields are required",
        error: true
      });
    }

    const currentUser = await UserModel.findById(currentUserId);
    const requestIndex = currentUser.friendRequests.findIndex(
      req => req._id.toString() === requestId
    );

    if (requestIndex === -1) {
      return response.status(404).json({
        message: "Friend request not found",
        error: true
      });
    }

    const requestData = currentUser.friendRequests[requestIndex];
    const senderId = requestData.from;

    if (action === 'accept') {
      // Add to friends list
      currentUser.friends.push(senderId);
      const sender = await UserModel.findById(senderId);
      sender.friends.push(currentUserId);

      // Update request status
      currentUser.friendRequests[requestIndex].status = 'accepted';
      
      await sender.save();
    } else if (action === 'reject') {
      // Update request status
      currentUser.friendRequests[requestIndex].status = 'rejected';
    }

    await currentUser.save();

    return response.json({
      message: `Friend request ${action}ed successfully`,
      success: true
    });
  } catch (error) {
    return response.status(500).json({
      message: error.message || "Something went wrong",
      error: true
    });
  }
}

module.exports = { sendFriendRequest, handleFriendRequest }; 