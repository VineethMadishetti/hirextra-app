import UploadJob from "../models/UploadJob.js";
import importQueue from "../utils/queue.js";

export const deleteUploadJob = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user?._id; // Assuming auth middleware populates req.user

    // 1. Soft delete the UploadJob (keep the record, mark as deleted)
    const job = await UploadJob.findByIdAndUpdate(
      id,
      {
        isDeleted: true,
        deletedAt: new Date(),
        deletedBy: userId
      },
      { new: true }
    );

    if (!job) return res.status(404).json({ message: "Job not found" });

    // 2. Trigger background job to delete related candidates from DB
    if (importQueue) {
      await importQueue.add("delete-file", { jobId: job._id });
    }

    res.status(200).json({ message: "File marked as deleted and data cleanup started", job });
  } catch (error) {
    console.error("Delete error:", error);
    res.status(500).json({ message: error.message });
  }
};