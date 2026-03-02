import UploadJob from "../models/UploadJob.js";
import Candidate from "../models/Candidate.js";
import { cancelQueuedResumeImports } from "../utils/queue.js";

export const deleteUploadJob = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user?._id; // Assuming auth middleware populates req.user

    const job = await UploadJob.findById(id);
    if (!job) return res.status(404).json({ message: "Job not found" });

    // Mark deleted first so active workers can stop before external parser calls.
    await UploadJob.findByIdAndUpdate(
      id,
      {
        status: "DELETED",
        isDeleted: true,
        deletedAt: new Date(),
        deletedBy: userId,
      },
      { new: false },
    );

    // Remove pending resume-import tasks for this deleted job to stop further parsing/credit usage.
    const queueCancelResult = await cancelQueuedResumeImports(job._id);

    // Permanently remove candidate data and upload job record.
    await Candidate.deleteMany({ uploadJobId: job._id });
    await UploadJob.findByIdAndDelete(job._id);

    res.status(200).json({
      message: "Job deleted permanently",
      jobId: id,
      queueCancelResult,
    });
  } catch (error) {
    console.error("Delete error:", error);
    res.status(500).json({ message: error.message });
  }
};
