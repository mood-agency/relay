import { Context, Next } from "hono";
import env from "../config/env";

/**
 * API Key validation middleware.
 * 
 * Validates the X-API-KEY header against the SECRET_KEY environment variable.
 * If SECRET_KEY is not configured, the API will be open (no auth required).
 * 
 * Usage:
 * - Set SECRET_KEY environment variable to enable API key validation
 * - Send requests with header: X-API-KEY: <your-secret-key>
 */
export function apiKeyAuth() {
  return async (c: Context, next: Next) => {
    const secretKey = env.SECRET_KEY;
    
    // If no secret key is configured, skip validation (API is open)
    if (!secretKey) {
      return next();
    }
    
    const apiKey = c.req.header("X-API-KEY");
    
    if (!apiKey) {
      return c.json(
        { 
          error: "Unauthorized", 
          message: "Missing X-API-KEY header" 
        }, 
        401
      );
    }
    
    // Constant-time comparison to prevent timing attacks
    if (!constantTimeEqual(apiKey, secretKey)) {
      return c.json(
        { 
          error: "Unauthorized", 
          message: "Invalid API key" 
        }, 
        401
      );
    }
    
    return next();
  };
}

/**
 * Constant-time string comparison to prevent timing attacks.
 */
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }
  
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  
  return result === 0;
}
