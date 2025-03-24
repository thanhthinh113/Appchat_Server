require("dotenv").config(); // Load biến môi trường

const express = require("express");
const cors = require("cors");
const connectDB = require("./config/connectDB");
const router = require("./routes/index");
const checkEmail = require("./controller/checkEmail");
const checkPassword = require("./controller/checkPassword");
const userDetails = require("./controller/userDetails");
const cookiesParser = require("cookie-parser");
const logout = require("./controller/logout");
const updateUserDetails = require("./controller/updateUserDetails");

const app = express();
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
    app.listen(PORT, () => {
      console.log("server running at " + PORT);
    });
  })
  .catch((err) => {
    console.error("Error connecting to DB:", err);
  });

// api endpoints
app.use("/api", router);
//check email
router.post("/email", checkEmail);
//check password
router.post("/password", checkPassword);
//login user details
router.get("/user-details", userDetails);
//logout user
router.get("/logout", logout);
//update user
router.post("/update-user", updateUserDetails);
