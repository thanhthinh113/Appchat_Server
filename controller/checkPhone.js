const jwt = require("jsonwebtoken");
const UserModel = require("../models/UserModel");

const JWT_SECRET = process.env.JWT_SECRET || "yourSecretKey";
const TOKEN_EXPIRES_IN = "15m";

async function checkPhone(request, response) {
  try {
    const { phone } = request.body;

    const user = await UserModel.findOne({ phone }).select("-password");
    if (!user) {
      return response.status(400).json({
        message: "User does not exist",
        error: true,
      });
    }

    const token = jwt.sign({ id: user._id, phone: user.phone }, JWT_SECRET, {
      expiresIn: TOKEN_EXPIRES_IN,
    });

    return response.status(200).json({
      message: "Phone number verified. Reset token generated.",
      success: true,
      data: user,
      token: token,
    });
  } catch (error) {
    return response.status(500).json({
      message: error.message || error,
      error: true,
    });
  }
}

module.exports = checkPhone;
