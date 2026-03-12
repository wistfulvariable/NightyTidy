// Temporary launcher: starts GUI with rate-limit simulation enabled
process.env.NIGHTYTIDY_TEST_RATE_LIMIT = '1';
import('./gui/server.js');
