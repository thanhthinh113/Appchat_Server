const bcrypt = require("bcryptjs");
const getUserDetailFromToken = require("../helpers/getUserDetailFromToken");
const UserModel = require("../models/UserModel");

async function changePassword(req, res) {
  try {
    const { currentPassword, newPassword } = req.body;

    // Get user from token
    const token = req.cookies.token || req.headers.authorization?.split(" ")[1] || "";
    const user = await getUserDetailFromToken(token);

    if (!user) {
      return res.status(401).json({
        message: "Unauthorized. Invalid or missing token",
        error: true,
      });
    }

    // Find user in database
    const userInDb = await UserModel.findById(user._id);
    if (!userInDb) {
      return res.status(404).json({
        message: "User not found",
        error: true,
      });
    }

    // Verify current password
    const isPasswordValid = await bcrypt.compare(currentPassword, userInDb.password);
    if (!isPasswordValid) {
      return res.status(401).json({
        message: "Current password is incorrect",
        error: true,
      });
    }

    // Hash and save new password
    userInDb.password = await bcrypt.hash(newPassword, 10);
    await userInDb.save();

    return res.status(200).json({
      message: "Password changed successfully",
      success: true,
    });
  } catch (error) {
    return res.status(500).json({
      message: error.message || "Something went wrong",
      error: true,
    });
  }
}

module.exports = changePassword;