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
    try {
        // Hard delete all candidates associated with this job
        await Candidate.deleteMany({ uploadJobId: id });
        
        // Hard delete the UploadJob record itself
        await UploadJob.findByIdAndDelete(id);
        
        res.status(200).json({ message: 'Job and associated candidates deleted successfully' });
    } catch (error) {
        console.error('Error deleting job:', error);
        res.status(500).json({ message: 'Error deleting job', error: error.message });
    }
};
