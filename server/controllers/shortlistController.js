import Shortlist from '../models/Shortlist.js';
import Candidate from '../models/Candidate.js';

const PUBLIC_CANDIDATE_FIELDS = 'fullName jobTitle company location locality skills experience education summary linkedinUrl';

export const getShortlists = async (req, res) => {
  try {
    const lists = await Shortlist.find({ createdBy: req.user._id, isDeleted: false })
      .sort({ createdAt: -1 })
      .select('-candidateIds');
    res.json(lists);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const createShortlist = async (req, res) => {
  try {
    const { name, candidateIds } = req.body;
    if (!name?.trim()) return res.status(400).json({ message: 'Shortlist name is required' });
    if (!Array.isArray(candidateIds) || candidateIds.length === 0)
      return res.status(400).json({ message: 'Select at least one candidate' });
    const list = await Shortlist.create({ name, candidateIds, createdBy: req.user._id });
    res.status(201).json(list);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const deleteShortlist = async (req, res) => {
  try {
    const list = await Shortlist.findOneAndUpdate(
      { _id: req.params.id, createdBy: req.user._id },
      { isDeleted: true }
    );
    if (!list) return res.status(404).json({ message: 'Shortlist not found' });
    res.json({ message: 'Shortlist deleted' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Public endpoint — no auth required
export const getPublicShortlist = async (req, res) => {
  try {
    const list = await Shortlist.findOne({ shareToken: req.params.token, isDeleted: false });
    if (!list) return res.status(404).json({ message: 'Shortlist not found or link has expired' });

    const candidates = await Candidate.find({
      _id: { $in: list.candidateIds },
      isDeleted: false,
    }).select(PUBLIC_CANDIDATE_FIELDS);

    res.json({ name: list.name, createdAt: list.createdAt, candidates });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
