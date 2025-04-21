const jwt = require("jsonwebtoken");
const UserModel = require("../models/UserModel");

const getUserDetailFromToken = async (token) => {
  try {
    if (!token) {
      return {
        message: "Token is missing",
        logout: true,
      };
    }

    // Kiểm tra biến môi trường JWT_SECRET_KEY
    const secretKey = process.env.JWT_SECREAT_KEY;
    if (!secretKey) {
      console.error("JWT_SECRET_KEY is not defined in environment variables");
      return {
        message: "Server configuration error",
        logout: true,
      };
    }

    // Giải mã token
    const decoded = jwt.verify(token, secretKey);

    // Tìm người dùng
    const user = await UserModel.findById(decoded.id).select("-password");

    if (!user) {
      return {
        message: "User not found",
        logout: true,
      };
    }

    return user;
  } catch (error) {
    console.error("Error in getUserDetailFromToken:", error.message);
    return {
      message: "Invalid or expired token",
      logout: true,
    };
  }
};

module.exports = getUserDetailFromToken;
