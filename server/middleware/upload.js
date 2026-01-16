const multer = require('multer');

// Configure multer for memory storage (files are kept in buffer)
const upload = multer({ storage: multer.memoryStorage() });

module.exports = upload;
