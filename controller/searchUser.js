const UserModel = require("../models/UserModel");

async function searchUser(request, response) {
  try {
    const { search } = request.body;
    const currentUserId = request.query.currentUserId;
    
    if (!currentUserId) {
      return response.status(400).json({
        message: "Current user ID is required as a query parameter",
        error: true,
      });
    }

    const query = new RegExp(search, "i", "g");

    const users = await UserModel.find({
      $and: [
        { $or: [
          { name: query },
          { phone: query }
        ]},
        { _id: { $ne: currentUserId } } // Exclude current user
      ]
    }).select("-password");

    // Get current user's friends list and friend requests
    const currentUser = await UserModel.findById(currentUserId)
      .select("friends friendRequests");

    const friendsList = currentUser.friends || [];
    const friendRequests = currentUser.friendRequests || [];

    // Add friend status and request status to each user
    const usersWithStatus = users.map(user => {
      const isFriend = friendsList.includes(user._id.toString());
      const request = friendRequests.find(req => 
        req.from.toString() === user._id.toString() && req.status === 'pending'
      );

      return {
        ...user.toObject(),
        isFriend,
        hasPendingRequest: !!request,
        requestId: request?._id
      };
    });

    return response.json({
      message: "all user",
      data: usersWithStatus,
      success: true,
    });
  } catch (error) {
    return response.status(500).json({
      message: error.message || error,
      error: true,
    });
  }
}

module.exports = searchUser;
