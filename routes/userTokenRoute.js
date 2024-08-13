// cartRoutes.js

const express = require("express");
const router = express.Router();
const tokenController = require("../controller/tokenController");

// Route to get refreshToken
router.post("/refreshToken", tokenController.getRefreshToken);

module.exports = router;
