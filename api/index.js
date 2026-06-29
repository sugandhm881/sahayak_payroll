// Vercel serverless entry point.
// The Express app (server.js) is exported and used directly as the handler —
// an Express app is itself a (req, res) function, which Vercel supports.
module.exports = require('../server.js');
