const express = require("express");
const router = express.Router();
const { sendMessage, getMessages, deleteMessage, reactToMessage } = require("../controller/message");
const searchMessage = require("../controller/searchMessage");

// ... existing code ...

// Search messages in a conversation
router.post("/search", searchMessage);

module.exports = router; 