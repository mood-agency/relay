/**
 * K6 Tools for Agent Use
 *
 * Tools that allow the LLM to validate and fix k6 scripts autonomously.
 */

import { tool } from 'ai';
import { z } from 'zod';
import { exec } from 'child_process';
import { promisify } from 'util';
import { readFile, writeFile } from '../../utils/files.js';

const execAsync = promisify(exec);

/**
 * Validate a k6 script using dry-run
 */
export const validateK6Script = tool({
  description: 'Run k6 dry-run validation on a script file to check for syntax errors. Returns validation result with any error messages.',
  parameters: z.object({
    scriptPath: z.string().describe('Absolute path to the k6 script file to validate'),
  }),
  execute: async ({ scriptPath }) => {
    try {
      await execAsync(`k6 run --dry-run "${scriptPath}"`, {
        timeout: 30000,
      });
      return {
        valid: true,
        message: 'Script is valid and passes k6 dry-run validation',
      };
    } catch (err) {
      const error = err as { stderr?: string; stdout?: string; message?: string };
      const errorMessage = error.stderr || error.stdout || error.message || 'Unknown validation error';
      return {
        valid: false,
        error: errorMessage,
        message: 'Script has errors. Review the error message and fix the code.',
      };
    }
  },
});

/**
 * Read the contents of a script file
 */
export const readScript = tool({
  description: 'Read the current content of a k6 script file to analyze or fix it.',
  parameters: z.object({
    scriptPath: z.string().describe('Absolute path to the script file to read'),
  }),
  execute: async ({ scriptPath }) => {
    try {
      const content = await readFile(scriptPath);
      return {
        success: true,
        content,
        message: `Successfully read script from ${scriptPath}`,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        error: message,
        message: `Failed to read script: ${message}`,
      };
    }
  },
});

/**
 * Write fixed code to a script file
 */
export const writeScript = tool({
  description: 'Write corrected JavaScript code to a k6 script file. Use this after fixing errors in the code.',
  parameters: z.object({
    scriptPath: z.string().describe('Absolute path to the script file to write'),
    code: z.string().describe('The corrected k6 JavaScript code to write to the file'),
  }),
  execute: async ({ scriptPath, code }) => {
    try {
      await writeFile(scriptPath, code);
      return {
        success: true,
        message: `Successfully wrote fixed code to ${scriptPath}. Now validate it again to confirm the fix.`,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        error: message,
        message: `Failed to write script: ${message}`,
      };
    }
  },
});
