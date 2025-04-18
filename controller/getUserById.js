const UserModel = require('../models/UserModel');

async function getUserById(request, response) {
  try {
    const { userId } = request.params;

    if (!userId) {
      return response.status(400).json({
        message: "User ID is required",
        error: true
      });
    }

    const user = await UserModel.findOne({ _id: userId }).select("name profile_pic");

    if (!user) {
      return response.status(404).json({
        message: "User not found",
        error: true
      });
    }

    return response.json({
      message: "User details retrieved successfully",
      data: {
        name: user.name,
        profile_pic: user.profile_pic
      },
      success: true
    });
  } catch (error) {
    return response.status(500).json({
      message: error.message || "Something went wrong",
      error: true
    });
  }
}

module.exports = getUserById;