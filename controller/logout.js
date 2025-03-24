async function logout(request, response) {
  try {
    const cookieOptions = {
      httpOnly: true,
      secure: true,
    };
    return response.cookie("token", "", cookieOptions).status(200).json({
      message: "secsion out",
      success: true,
    });
  } catch (error) {
    return response.status(500).json({
      message: error.message || error,
      error: true,
    });
  }
}
module.exports = logout;
