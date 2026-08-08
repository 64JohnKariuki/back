// cartRoutes.js

const router = require("express").Router();
const tokenController = require("../controller/tokenController");

// Route to get refreshToken
router.post("/refreshToken", tokenController.getRefreshToken);

module.exports = router;
