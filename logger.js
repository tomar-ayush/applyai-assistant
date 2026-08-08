// logger.js - Global logger configuration
// Set to true to see debug logs in the console
const APPLYAI_DEBUG_MODE = false; 

const Logger = {
  debug: (...args) => { if (APPLYAI_DEBUG_MODE) console.log(...args); },
  warn: (...args) => { if (APPLYAI_DEBUG_MODE) console.warn(...args); },
  error: (...args) => { if (APPLYAI_DEBUG_MODE) console.error(...args); }
};
