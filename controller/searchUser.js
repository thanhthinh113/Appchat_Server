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

    const user = await UserModel.find({
      $and: [
        { $or: [
          { name: query },
          { phone: query }
        ]},
        { _id: { $ne: currentUserId } } // Exclude current user
      ]
    }).select("-password");

    return response.json({
      message: "all user",
      data: user,
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
