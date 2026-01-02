import crypto from "crypto";
import { logger } from "./utils.js";

/**
 * Handles message signing and verification for security.
 */
export class MessageSecurity {
  /**
   * Creates a new MessageSecurity instance.
   * @param {string} secret_key - The secret key for HMAC.
   * @throws {Error} If secret_key is missing.
   */
  constructor(secret_key) {
    if (!secret_key)
      throw new Error("Secret key is required for MessageSecurity");
    this.secret_key = Buffer.from(secret_key, "utf-8");
  }

  /**
   * Signs a message using HMAC SHA256.
   * @param {string} message - The message string to sign.
   * @returns {string} The signed message (message|signature).
   */
  signMessage(message) {
    const hmac = crypto.createHmac("sha256", this.secret_key);
    hmac.update(message, "utf-8");
    const signature = hmac.digest("hex");
    return `${message}|${signature}`;
  }

  /**
   * Verifies a signed message.
   * @param {string} signedMessage - The signed message string.
   * @returns {string|null} The original message if valid, or null if invalid.
   */
  verifyMessage(signedMessage) {
    try {
      const parts = signedMessage.split("|");
      if (parts.length < 2) return null; // Handle cases where there's no pipe

      const signature = parts.pop();
      const message = parts.join("|");

      const hmac = crypto.createHmac("sha256", this.secret_key);
      hmac.update(message, "utf-8");
      const expectedSignature = hmac.digest("hex");

      if (
        crypto.timingSafeEqual(
          Buffer.from(signature, "hex"),
          Buffer.from(expectedSignature, "hex")
        )
      ) {
        return message;
      }
      return null;
    } catch (error) {
      logger.error(`Error verifying message: ${error.message}`);
      return null;
    }
  }
}
