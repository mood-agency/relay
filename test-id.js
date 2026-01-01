const crypto = require('crypto');
const generateId = () => crypto.randomBytes(16).toString("base64url");
console.log("ID:", generateId());
console.log("Length:", generateId().length);
