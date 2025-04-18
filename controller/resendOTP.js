const jwt = require("jsonwebtoken");
const UserModel = require("../models/UserModel");
const getUserDetailFromToken = require("../helpers/getUserDetailFromToken");

const JWT_SECRET = process.env.JWT_SECRET || "yourSecretKey";
const TOKEN_EXPIRES_IN = "30m"; // Updated to 30 minutes to match checkPhone.js
const OTP_EXPIRES_IN = 30; // 60 seconds for OTP expiration

async function resendOTP(request, response) {
  try {
    const { token } = request.body;

    // Get user from token using the helper function
    const user = await getUserDetailFromToken(token);
    
    if (!user || user.logout) {
      return response.status(400).json({
        message: user?.message || "Invalid or expired token",
        error: true,
      });
    }

    // Generate new token
    const newToken = jwt.sign({ id: user._id, phone: user.phone }, JWT_SECRET, {
      expiresIn: TOKEN_EXPIRES_IN,
    });

    // Calculate token expiration time (30 minutes)
    const tokenExpirationTime = new Date();
    tokenExpirationTime.setMinutes(tokenExpirationTime.getMinutes() + 30);

    // Calculate OTP expiration time (30 seconds)
    const otpExpirationTime = new Date();
    otpExpirationTime.setSeconds(otpExpirationTime.getSeconds() + OTP_EXPIRES_IN);

    return response.status(200).json({
      message: "New OTP token generated successfully",
      success: true,
      data: user,
      token: newToken,
      tokenExpiresAt: tokenExpirationTime.toISOString(),
      otpExpiresAt: otpExpirationTime.toISOString(),
      otpExpiresIn: OTP_EXPIRES_IN
    });
  } catch (error) {
    return response.status(500).json({
      message: error.message || error,
      error: true,
    });
  }
}

module.exports = resendOTP; 