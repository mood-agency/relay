/**
 * Progress reporting utilities using ora and chalk
 */

import ora, { type Ora } from 'ora';
import chalk from 'chalk';

/**
 * Create a spinner for long-running operations
 */
export function createSpinner(text: string): Ora {
  return ora({
    text,
    spinner: 'dots',
  });
}

/**
 * Log success message
 */
export function success(message: string): void {
  console.log(chalk.green('✅'), message);
}

/**
 * Log error message
 */
export function error(message: string): void {
  console.log(chalk.red('❌'), message);
}

/**
 * Log warning message
 */
export function warn(message: string): void {
  console.log(chalk.yellow('⚠️'), message);
}

/**
 * Log info message
 */
export function info(message: string): void {
  console.log(chalk.blue('ℹ️'), message);
}

/**
 * Log a step in a process
 */
export function step(emoji: string, message: string): void {
  console.log(emoji, message);
}

/**
 * Log debug message (only if verbose)
 */
export function debug(message: string, verbose: boolean): void {
  if (verbose) {
    console.log(chalk.gray('[DEBUG]'), message);
  }
}

/**
 * Log a list item
 */
export function listItem(message: string): void {
  console.log(chalk.gray('   •'), message);
}

/**
 * Log section header
 */
export function section(title: string): void {
  console.log();
  console.log(chalk.bold(title));
}

/**
 * Progress counter for batch operations
 */
export class ProgressCounter {
  private current = 0;
  private spinner: Ora;

  constructor(
    private total: number,
    private label: string,
  ) {
    this.spinner = ora({
      text: this.formatText(),
      spinner: 'dots',
    }).start();
  }

  private formatText(): string {
    return `${this.label} [${this.current}/${this.total}]`;
  }

  increment(): void {
    this.current++;
    this.spinner.text = this.formatText();
  }

  succeed(message?: string): void {
    this.spinner.succeed(message ?? `${this.label} complete`);
  }

  fail(message?: string): void {
    this.spinner.fail(message ?? `${this.label} failed`);
  }

  update(text: string): void {
    this.spinner.text = text;
  }
}

/**
 * Format duration in human-readable format
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}
