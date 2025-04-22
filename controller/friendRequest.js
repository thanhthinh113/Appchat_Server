const UserModel = require("../models/UserModel");
const FriendRequestModel = require("../models/FriendRequestModel");

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
    const existingRequest = await FriendRequestModel.findOne({
      $or: [
        { sender: currentUserId, receiver: targetUserId, status: 'pending' },
        { sender: targetUserId, receiver: currentUserId, status: 'pending' }
      ]
    });

    if (existingRequest) {
      return response.status(400).json({
        message: "Friend request already exists",
        error: true
      });
    }

    // Create new friend request
    const newRequest = new FriendRequestModel({
      sender: currentUserId,
      receiver: targetUserId,
      status: 'pending'
    });

    await newRequest.save();

    return response.json({
      message: "Friend request sent successfully",
      success: true,
      requestId: newRequest._id
    });
  } catch (error) {
    return response.status(500).json({
      message: error.message || "Something went wrong",
      error: true
    });
  }
}

async function checkFriendRequest(request, response) {
  try {
    const { currentUserId, targetUserId } = request.body;

    if (!currentUserId || !targetUserId) {
      return response.status(400).json({
        message: "Both currentUserId and targetUserId are required",
        error: true
      });
    }

    // Check if users are friends
    const currentUser = await UserModel.findById(currentUserId);
    if (!currentUser) {
      return response.status(404).json({
        message: "Current user not found",
        error: true
      });
    }

    const isFriend = currentUser.friends.includes(targetUserId);

    // Check for pending friend request
    const friendRequest = await FriendRequestModel.findOne({
      $or: [
        { sender: currentUserId, receiver: targetUserId, status: 'pending' },
        { sender: targetUserId, receiver: currentUserId, status: 'pending' }
      ]
    });

    return response.json({
      success: true,
      isFriend,
      hasPendingRequest: !!friendRequest,
      requestId: friendRequest?._id,
      isReceiver: friendRequest ? friendRequest.receiver.toString() === currentUserId : false
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

    const friendRequest = await FriendRequestModel.findById(requestId);

    if (!friendRequest) {
      return response.status(404).json({
        message: "Friend request not found",
        error: true
      });
    }

    if (friendRequest.receiver.toString() !== currentUserId) {
      return response.status(403).json({
        message: "You don't have permission to handle this request",
        error: true
      });
    }

    if (action === 'accept') {
      // Update request status
      friendRequest.status = 'accepted';
      await friendRequest.save();

      // Add to friends list
      await UserModel.updateOne(
        { _id: friendRequest.sender },
        { $addToSet: { friends: friendRequest.receiver } }
      );
      await UserModel.updateOne(
        { _id: friendRequest.receiver },
        { $addToSet: { friends: friendRequest.sender } }
      );
    } else if (action === 'reject') {
      // Update request status
      friendRequest.status = 'rejected';
      await friendRequest.save();
    }

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

module.exports = {
  sendFriendRequest,
  checkFriendRequest,
  handleFriendRequest
}; 