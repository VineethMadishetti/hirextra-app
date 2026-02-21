import mongoose from "mongoose";

const enrichmentChangeSchema = new mongoose.Schema(
  {
    field: { type: String, required: true },
    oldValue: { type: String, default: "" },
    newValue: { type: String, default: "" },
    confidence: { type: Number, default: 0 },
    source: { type: String, default: "" },
  },
  { _id: false }
);

const enrichmentLogSchema = new mongoose.Schema(
  {
    candidateId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Candidate",
      required: true,
      index: true,
    },
    action: {
      type: String,
      enum: ["RUN", "APPROVE", "REJECT", "EDIT"],
      required: true,
      index: true,
    },
    provider: { type: String, default: "" },
    performedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    changes: { type: [enrichmentChangeSchema], default: [] },
    metadata: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  { timestamps: true }
);

enrichmentLogSchema.index({ createdAt: -1, candidateId: 1 });

export default mongoose.model("EnrichmentLog", enrichmentLogSchema);

