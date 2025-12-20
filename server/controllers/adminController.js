import Candidate from '../models/Candidate.js';
import UploadJob from '../models/UploadJob.js';

export const resetDatabase = async (req, res) => {
  try {
    // Delete all candidates and upload jobs
    await Candidate.deleteMany({});
    await UploadJob.deleteMany({});
    
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
        }
        
        res.status(200).json({ message: 'Job and associated candidates deleted successfully' });
    } catch (error) {
        console.error('Error deleting job:', error);
        res.status(500).json({ message: 'Error deleting job', error: error.message });
    }
};

