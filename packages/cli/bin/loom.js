#!/usr/bin/env node
// Committed launcher so pnpm can link `loom` at install time, before dist/ exists.
import '../dist/bin.js';
