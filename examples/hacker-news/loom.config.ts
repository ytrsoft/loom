/**
 * @fileoverview Project configuration. Everything here is optional: without
 * this file Loom would still find the spiders in src/spiders/ and store data
 * in .loom/loom.db.
 */

import {defineConfig, detectBlocking} from 'loom';

import {topStories} from './src/routes.js';

export const config = defineConfig({
  database: process.env['LOOM_DATABASE_URL'] ?? 'sqlite:./data/loom.db',
  defaults: {
    retries: 3,
    timeout: '45s',
  },
  // Applied to every spider: retry block pages on a fresh session.
  plugins: [detectBlocking()],
  server: {
    port: 3000,
    routes: [topStories],
  },
});
