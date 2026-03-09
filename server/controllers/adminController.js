import Candidate from '../models/Candidate.js';
import UploadJob from '../models/UploadJob.js';
import DeleteLog from '../models/DeleteLog.js';
import PrivateDatabase from '../models/PrivateDatabase.js';
import User from '../models/User.js';
import { cancelQueuedResumeImports } from '../utils/queue.js';

export const getUserStats = async (req, res) => {
  try {
    const [candidateCounts, databaseCounts, uploadCounts] = await Promise.all([
      Candidate.aggregate([
        { $group: { _id: '$createdBy', count: { $sum: 1 } } },
      ]),
      PrivateDatabase.aggregate([
        { $match: { isDeleted: { $ne: true } } },
        { $group: { _id: '$owner', count: { $sum: 1 } } },
      ]),
      UploadJob.aggregate([
        { $group: { _id: '$uploadedBy', count: { $sum: 1 } } },
      ]),
    ]);

    const toMap = (arr) =>
      arr.reduce((m, { _id, count }) => {
        if (_id) m[String(_id)] = count;
        return m;
      }, {});

    res.json({
      candidates: toMap(candidateCounts),
      databases: toMap(databaseCounts),
      uploads: toMap(uploadCounts),
    });
  } catch (error) {
    console.error('Error fetching user stats:', error);
    res.status(500).json({ message: 'Failed to fetch user stats' });
  }
};

export const resetDatabase = async (req, res) => {
  try {
    // Delete all candidates and upload jobs
    await Candidate.deleteMany({});
    await UploadJob.deleteMany({});
    
    await DeleteLog.create({
      entityType: 'DATABASE',
      entityName: 'Full Database Reset',
      deletedBy: req.user._id
    });
    
    res.json({ message: 'Database reset successfully' });
  } catch (error) {
    console.error('Error resetting database:', error);
    res.status(500).json({ message: 'Failed to reset database' });
  }
};

export const deleteJob = async (req, res) => {
    const { id } = req.params;
    console.log(`Attempting to delete job with ID: ${id}`);
    try {
        // Fetch job details for logging before deletion
        const job = await UploadJob.findById(id);

        // Mark as deleted first so any active resume worker can stop before charging parser credits
        await UploadJob.findByIdAndUpdate(id, {
            status: "DELETED",
            isDeleted: true,
            deletedAt: new Date(),
            deletedBy: req.user?._id
        }).catch(() => {});

        const queueCancelResult = await cancelQueuedResumeImports(id);
        console.log(`[deleteJob] Queue cancel summary for ${id}:`, queueCancelResult);

        // Count candidates before deletion for logging
        const candidateCount = await Candidate.countDocuments({ uploadJobId: id });
        console.log(`Found ${candidateCount} candidates linked to job ${id}`);
        
        // Hard delete all candidates associated with this job
        const deleteCandidatesResult = await Candidate.deleteMany({ uploadJobId: id });
        console.log(`Deleted ${deleteCandidatesResult.deletedCount} candidates`);
        
        // Hard delete the UploadJob record itself
        const deleteJobResult = await UploadJob.findByIdAndDelete(id);
        if (!deleteJobResult) {
            console.warn(`Job with ID ${id} not found or already deleted`);
        } else {
            console.log(`Deleted job with ID: ${id}`);

            if (job) {
                await DeleteLog.create({
                    entityType: 'FILE',
                    entityName: job.originalName || job.fileName,
                    deletedBy: req.user._id
                });
            }
        }
        
        res.status(200).json({ message: 'Job and associated candidates deleted successfully' });
    } catch (error) {
        console.error('Error deleting job:', error);
        res.status(500).json({ message: 'Error deleting job', error: error.message });
    }
};
