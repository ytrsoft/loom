#!/usr/bin/env node
/**
 * @fileoverview Entry point of the `loom` executable.
 */

import {main} from './main.js';

process.exitCode = await main(process.argv.slice(2));
