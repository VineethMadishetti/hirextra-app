import mongoose from 'mongoose';
import Candidate from '../models/Candidate.js';
import { cleanAndValidateCandidate } from '../utils/dataCleaner.js';

const cleanExistingCandidates = async () => {
  try {
    // Connect to MongoDB (adjust connection string as needed)
    await mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI || 'mongodb://localhost:27017/hirextra');

    console.log('Connected to MongoDB');

    // Get all candidates
    const candidates = await Candidate.find({ isDeleted: { $ne: true } });
    console.log(`Found ${candidates.length} candidates to clean`);

    let updated = 0;
    let invalid = 0;

    for (const candidate of candidates) {
      const originalData = candidate.toObject();
      const cleaned = cleanAndValidateCandidate(originalData);

      if (!cleaned) {
        // Mark as deleted if invalid
        await Candidate.findByIdAndUpdate(candidate._id, { isDeleted: true });
        invalid++;
        console.log(`Marked invalid candidate ${candidate._id} as deleted`);
      } else {
        // Check if data changed
        const changed = Object.keys(cleaned).some(key => 
          originalData[key] !== cleaned[key] && key !== '_id' && key !== 'createdAt' && key !== 'updatedAt'
        );

        if (changed) {
          await Candidate.findByIdAndUpdate(candidate._id, cleaned);
          updated++;
          console.log(`Updated candidate ${candidate._id}`);
        }
      }
    }

    console.log(`Cleaning complete: ${updated} updated, ${invalid} marked as deleted`);

  } catch (error) {
    console.error('Error cleaning candidates:', error);
  } finally {
    await mongoose.disconnect();
    console.log('Disconnected from MongoDB');
  }
};

cleanExistingCandidates();