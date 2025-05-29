require("dotenv").config(); // Load biến môi trường

const express = require("express");
const cors = require("cors");
const connectDB = require("./config/connectDB");
const router = require("./routes/index");
const checkEmail = require("./controller/checkPhone");
const checkPassword = require("./controller/checkPassword");
const userDetails = require("./controller/userDetails");
const cookiesParser = require("cookie-parser");
const logout = require("./controller/logout");
const updateUserDetails = require("./controller/updateUserDetails");
const resetPassword = require("./controller/resetPassword");
const changePassword = require("./controller/changePassword");
const searchUser = require("./controller/searchUser");
const { sendFriendRequest, handleFriendRequest } = require("./controller/friendRequest");
const { app, server } = require("./socket/index");
const checkPhone = require("./controller/checkPhone");

//const app = express();
const PORT = process.env.PORT || 8080;

// Cấu hình CORS
app.use(
  cors({
    origin: process.env.FRONTEND_URL,
    credentials: true,
  })
);
app.use(express.json());
app.use(cookiesParser());

app.get("/", (request, response) => {
  response.json({ message: "server running at " + PORT });
});

// Kết nối MongoDB trước khi chạy server
connectDB()
  .then(() => {
    server.listen(PORT, () => {
      console.log("server running at " + PORT);
    });
  })
  .catch((err) => {
    console.error("Error connecting to DB:", err);
  });

// api endpoints
app.use("/api", router);
//check email
router.post("/phone", checkPhone);
//check password
router.post("/password", checkPassword);
//login user details
router.get("/user-details", userDetails);
//logout user
router.get("/logout", logout);
//update user
router.post("/update-user", updateUserDetails);

router.post("/reset-password", resetPassword);
router.post("/change-password", changePassword);  
router.post("/search-user", searchUser);
router.post("/send-friend-request", sendFriendRequest);
router.post("/handle-friend-request", handleFriendRequest);

//check phone
router.post("/check-phone", checkPhone);
