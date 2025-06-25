const fs = require('fs');
const path = require('path');

/**
 * Handles all logging operations
 */
class Logger {
    /**
     * @param {Object} config - Configuration object
     */
    constructor(config) {
        this.config = config;
        this.initializeLogFiles();
    }

    initializeLogFiles() {
        const timestamp = new Date().toISOString();
        const header = `=== Gumroad Bulk Signup - ${timestamp} ===\n`;

        this.writeFileSync(this.config.logFile, header);
        this.writeFileSync(this.config.successFile, header);
        this.writeFileSync(this.config.failedFile, header);
    }

    writeFileSync(filePath, content) {
        try {
            fs.writeFileSync(filePath, content);
        } catch (error) {
            console.error(`Failed to initialize log file ${filePath}:`, error);
        }
    }

    /**
     * Log a message to console and log file
     * @param {string} message 
     */
    log(message) {
        const timestamp = new Date().toLocaleString();
        const logMessage = `[${timestamp}] ${message}`;
        console.log(logMessage);
        this.appendToFile(this.config.logFile, logMessage);
    }

    /**
     * Log a successful signup
     * @param {string} email 
     * @param {string} details 
     */
    logSuccess(email, details = '') {
        const message = `SUCCESS: ${email} ${details}`;
        this.log(message);
        this.appendToFile(this.config.successFile, `${email}\n`);
    }

    /**
     * Log a failed signup
     * @param {string} email 
     * @param {string} error 
     * @param {string} details 
     */
    logFailure(email, error, details = '') {
        const message = `FAILED: ${email} - ${error} ${details}`;
        this.log(message);
        this.appendToFile(this.config.failedFile, `${email} - ${error}\n`);
    }

    appendToFile(filePath, content) {
        try {
            fs.appendFileSync(filePath, `${content}\n`);
        } catch (error) {
            console.error(`Failed to write to log file ${filePath}:`, error);
        }
    }
}

module.exports = Logger;