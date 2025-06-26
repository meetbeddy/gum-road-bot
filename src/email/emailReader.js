const path = require('path');
const xlsx = require('xlsx');
const fs = require('fs');

/**
 * Reads emails from various file formats
 */
class EmailReader {
    /**
     * @param {Logger} logger 
     */
    constructor(logger) {
        this.logger = logger;
    }

    /**
     * Read emails from file (supports CSV and Excel)
     * @param {string} filePath 
     * @returns {string[]} Array of emails
     */
    readEmailsFromFile(filePath) {
        const resolvedPath = fs.existsSync(filePath)
            ? path.resolve(process.cwd(), filePath)
            : path.resolve(process.cwd(), 'email-lists', filePath);

        this.logger.log(`Resolved email file path: ${resolvedPath}`);
        try {
            if (resolvedPath.endsWith('.csv')) {
                return this.readEmailsFromCSV(resolvedPath);
            }
            return this.readEmailsFromExcel(resolvedPath);
        } catch (error) {
            this.logger.log(`Error reading file ${filePath}: ${error.message}`);
            return [];
        }
    }

    readEmailsFromExcel(filePath) {
        const workbook = xlsx.readFile(filePath);
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const data = xlsx.utils.sheet_to_json(worksheet);

        const emailColumn = this.findEmailColumn(data);
        const emails = data
            .map(row => row[emailColumn])
            .filter(email => email && email.includes('@'));

        this.logger.log(`Found ${emails.length} valid emails in ${filePath}`);
        return emails;
    }

    readEmailsFromCSV(filePath) {
        const content = fs.readFileSync(filePath, 'utf8');
        const lines = content.split('\n').filter(line => line.trim());
        const emails = [];

        for (const line of lines) {
            const parts = line.split(',');
            for (const part of parts) {
                const trimmed = part.trim().replace(/['"]/g, '');
                if (trimmed.includes('@')) {
                    emails.push(trimmed);
                    break;
                }
            }
        }

        this.logger.log(`Found ${emails.length} valid emails in CSV ${filePath}`);
        return emails;
    }

    findEmailColumn(data) {
        if (!data.length) return null;

        const emailColumns = ['email', 'Email', 'EMAIL', 'emails', 'Emails', 'EMAILS'];

        for (const col of emailColumns) {
            if (data[0].hasOwnProperty(col)) {
                return col;
            }
        }

        const firstColumn = Object.keys(data[0])[0];
        this.logger.log(`Warning: No standard email column found. Using: ${firstColumn}`);
        return firstColumn;
    }
}

module.exports = EmailReader;