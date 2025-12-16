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
  try {
    const { id } = req.params;
    
    // Delete the job and associated candidates
    await UploadJob.findByIdAndDelete(id);
    await Candidate.deleteMany({ jobId: id });
    
    res.json({ message: 'Job and associated data deleted successfully' });
  } catch (error) {
    console.error('Error deleting job:', error);
    res.status(500).json({ message: 'Failed to delete job' });
  }
};
