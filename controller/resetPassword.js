const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const UserModel = require("../models/UserModel");

const JWT_SECRET = process.env.JWT_SECRET || "yourSecretKey";

async function resetPassword(req, res) {
  try {
    const { token, newPassword } = req.body;

    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await UserModel.findById(decoded.id);

    if (!user) {
      return res.status(404).json({ message: "User not found", error: true });
    }

    user.password = await bcrypt.hash(newPassword, 10);
    await user.save();

    return res
      .status(200)
      .json({ message: "Password reset successful", success: true });
  } catch (err) {
    return res
      .status(401)
      .json({ message: "Invalid or expired token", error: true });
  }
}

module.exports = resetPassword;
