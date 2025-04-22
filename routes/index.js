const express = require("express");
const registerUser = require("../controller/registerUser");
const { sendFriendRequest, checkFriendRequest, handleFriendRequest } = require("../controller/friendRequest");

const router = express.Router();

router.post("/register", registerUser);
router.post("/send-friend-request", sendFriendRequest);
router.post("/check-friend-request", checkFriendRequest);
router.post("/handle-friend-request", handleFriendRequest);

module.exports = router;
