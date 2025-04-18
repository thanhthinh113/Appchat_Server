const jwt = require("jsonwebtoken");
const UserModel = require("../models/UserModel");
const getUserDetailFromToken = require("../helpers/getUserDetailFromToken");

const JWT_SECRET = process.env.JWT_SECRET || "yourSecretKey";
const TOKEN_EXPIRES_IN = "30m";

async function verifyOTP(request, response) {
  try {
    const { phone, otp, token } = request.body;

    // Verify token
    const user = await getUserDetailFromToken(token);
    
    if (!user || user.logout) {
      return response.status(400).json({
        message: user?.message || "Invalid or expired token",
        error: true,
      });
    }

    // In a real application, you would verify the OTP against what was sent
    // For this example, we'll just check if the OTP is not empty
    if (!otp || otp.length < 4) {
      return response.status(400).json({
        message: "Invalid OTP",
        error: true,
      });
    }

    // Generate new token for password reset
    const newToken = jwt.sign({ id: user._id, phone: user.phone }, JWT_SECRET, {
      expiresIn: TOKEN_EXPIRES_IN,
    });

    // Calculate token expiration time (30 minutes)
    const tokenExpirationTime = new Date();
    tokenExpirationTime.setMinutes(tokenExpirationTime.getMinutes() + 30);

    return response.status(200).json({
      message: "OTP verified successfully",
      success: true,
      data: user,
      token: newToken,
      tokenExpiresAt: tokenExpirationTime.toISOString()
    });
  } catch (error) {
    return response.status(500).json({
      message: error.message || error,
      error: true,
    });
  }
}

module.exports = verifyOTP; 