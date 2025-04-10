const getUserDetailFromToken = require("../helpers/getUserDetailFromToken");

async function userDetails(request, response) {
  try {
    const token =
      request.cookies.token ||
      request.headers.authorization?.split(" ")[1] ||
      "";

    const user = await getUserDetailFromToken(token);
    return response.status(200).json({
      message: "user details",
      data: user,
    });
  } catch (error) {
    return response.status(500).json({
      message: error.message || error,
      error: true,
    });
  }
}
module.exports = userDetails;
