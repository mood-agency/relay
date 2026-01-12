#!/usr/bin/env node
/**
 * Rohan CLI Entry Point
 * OpenAPI Test Generator for k6
 */

import 'dotenv/config';
import { createCli } from '../src/cli.js';

const cli = createCli();
cli.parse(process.argv);
