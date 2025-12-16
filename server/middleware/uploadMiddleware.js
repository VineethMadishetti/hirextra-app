import fs from "fs";
import csv from "csv-parser";
import Candidate from "../models/Candidate.js";
import UploadJob from "../models/UploadJob.js";

/**
 * Core CSV Processing Logic
 * This runs in background (called by queue worker)
 */
export const processCSVFile = async ({ filePath, mapping, jobId }) => {
  let totalRows = 0;
  let successRows = 0;
  let skippedRows = 0;

  const stream = fs.createReadStream(filePath).pipe(csv());

  for await (const row of stream) {
    totalRows++;

    try {
      // Apply mapping
      const mappedData = {};

      Object.entries(mapping).forEach(([dbField, csvField]) => {
        if (!csvField) return; // ignored field
        mappedData[dbField] = row[csvField]?.trim() || "";
      });

      // Save candidate
      await Candidate.create({
        ...mappedData,
        sourceFile: filePath,
        uploadJobId: jobId
      });

      successRows++;
    } catch (err) {
      skippedRows++;
    }
  }

  // Update job status
  await UploadJob.findByIdAndUpdate(jobId, {
    status: "COMPLETED",
    totalRows,
    successRows,
    failedRows: skippedRows
  });

  return { totalRows, successRows, skippedRows };
};
