const getUserDetailFromToken = require("../helpers/getUserDetailFromToken");
const UserModel = require("../models/UserModel");

async function updateUserDetails(request, response) {
  try {
    const authHeader = request.headers.authorization;
    const token =
      (authHeader && authHeader.startsWith("Bearer ")
        ? authHeader.split(" ")[1]
        : null) ||
      request.cookies.token ||
      "";

    const user = await getUserDetailFromToken(token);

    if (!user || user.logout) {
      return response.status(401).json({
        message: "Unauthorized. Invalid or missing token",
        error: true,
      });
    }

    const { name, profile_pic } = request.body;

    if (!name) {
      return response.status(400).json({ message: "Name is required" });
    }

    await UserModel.updateOne(
      { _id: user._id },
      {
        name,
        profile_pic,
      }
    );

    const userInformation = await UserModel.findById(user._id).select(
      "-password"
    );

    return response.json({
      message: "User updated successfully",
      data: userInformation,
      success: true,
    });
  } catch (error) {
    return response.status(500).json({
      message: error.message || "Something went wrong",
      error: true,
    });
  }
}

module.exports = updateUserDetails;
