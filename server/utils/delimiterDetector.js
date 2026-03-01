/**
 * Delimiter Detection Utility
 * Automatically detects CSV vs TSV files
 */
import logger from './logger.js';

/**
 * Detect the delimiter used in a CSV/TSV file
 * Checks the first line to determine if it's comma or tab-separated
 * 
 * @param {string} firstLine - The first line of the file
 * @param {string} fileExtension - File extension (.csv, .tsv, etc.)
 * @returns {string} - The detected delimiter (comma or tab)
 */
export const detectDelimiter = (firstLine, fileExtension = '') => {
  if (!firstLine) return ','; // Default to comma

  // Remove quoted sections to avoid counting delimiters inside quotes
  let unquotedLine = firstLine.replace(/"[^"]*"/g, '');
  
  // Count tabs and commas
  const tabCount = (unquotedLine.match(/\t/g) || []).length;
  const commaCount = (unquotedLine.match(/,/g) || []).length;

  // If significantly more tabs than commas, use tab
  if (tabCount > 0 && tabCount >= commaCount * 1.5) {
    logger.info(`📑 Detected TSV format (tabs: ${tabCount}, commas: ${commaCount})`);
    return '\t';
  }

  logger.info(`📑 Detected CSV format (commas: ${commaCount}, tabs: ${tabCount})`);
  return ',';
};

/**
 * Parse a CSV line with the given delimiter
 * Handles quoted fields correctly
 * 
 * @param {string} line - The CSV line to parse
 * @param {string} delimiter - The delimiter to use (default: ',')
 * @returns {string[]} - Array of parsed fields
 */
export const parseCsvLineWithDelimiter = (line, delimiter = ',') => {
  if (!line) return [];

  // Strip BOM (Byte Order Mark) if present
  if (line.charCodeAt(0) === 0xfeff) {
    line = line.slice(1);
  }

  const columns = [];
  let currentField = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        currentField += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === delimiter && !inQuotes) {
      columns.push(currentField);
      currentField = '';
    } else {
      currentField += char;
    }
  }
  columns.push(currentField);

  // Unquote and trim each field
  return columns.map((field, idx) => {
    let f = field.trim();
    if (f.startsWith('"') && f.endsWith('"')) {
      f = f.slice(1, -1).replace(/""/g, '"');
    }
    return f.trim() ? f.trim() : `Column_${idx + 1}`;
  });
};

export default {
  detectDelimiter,
  parseCsvLineWithDelimiter,
};
