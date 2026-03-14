import Job from '../models/Job.js';

export const getJobs = async (req, res) => {
  try {
    const { status } = req.query;
    const filter = { createdBy: req.user._id, isDeleted: false };
    if (status) filter.status = status;
    const jobs = await Job.find(filter).sort({ createdAt: -1 });
    res.json(jobs);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const createJob = async (req, res) => {
  try {
    const { title, client, location, skills, description, status, priority } = req.body;
    if (!title?.trim()) return res.status(400).json({ message: 'Job title is required' });
    const job = await Job.create({
      title, client, location, skills, description, status, priority,
      createdBy: req.user._id,
    });
    res.status(201).json(job);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const updateJob = async (req, res) => {
  try {
    const job = await Job.findOneAndUpdate(
      { _id: req.params.id, createdBy: req.user._id, isDeleted: false },
      req.body,
      { new: true }
    );
    if (!job) return res.status(404).json({ message: 'Job not found' });
    res.json(job);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const deleteJob = async (req, res) => {
  try {
    const job = await Job.findOneAndUpdate(
      { _id: req.params.id, createdBy: req.user._id },
      { isDeleted: true },
      { new: true }
    );
    if (!job) return res.status(404).json({ message: 'Job not found' });
    res.json({ message: 'Job deleted' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
