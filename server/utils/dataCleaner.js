// Data cleaning and validation utilities
export const cleanAndValidateCandidate = (data) => {
  if (!data) return null;
  const cleaned = { ...data };

  // 1. Clean Phone: Remove all non-digit/non-plus characters
  if (cleaned.phone) {
    cleaned.phone = cleaned.phone.replace(/[^0-9+]/g, '');
    const phoneRegex = /^\+?[0-9]{7,15}$/;
    if (!phoneRegex.test(cleaned.phone)) {
        cleaned.phone = '';
    }
  }

  // 2. Validate Email (Relaxed)
  if (cleaned.email) {
      cleaned.email = cleaned.email.trim();
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(cleaned.email)) {
          cleaned.email = ''; // Invalid email -> Clear it, don't reject row yet
      }
  }

  // 3. Clean and validate text fields with stricter rules
  const cleanText = (text) => text ? text.trim().replace(/\s+/g, ' ') : '';

  cleaned.fullName = cleanText(cleaned.fullName);
  cleaned.jobTitle = cleanText(cleaned.jobTitle);
  cleaned.company = cleanText(cleaned.company);
  cleaned.industry = cleanText(cleaned.industry);
  cleaned.summary = cleanText(cleaned.summary);
  cleaned.experience = cleanText(cleaned.experience);

  // Stricter cleaning for specific fields
  if (cleaned.jobTitle) {
    // Job titles should not contain location-like patterns or be too long
    if (cleaned.jobTitle.length > 50) cleaned.jobTitle = cleaned.jobTitle.substring(0, 50);
    // Remove excessive special characters
    cleaned.jobTitle = cleaned.jobTitle.replace(/[^a-zA-Z\s\-&]/g, '');
  }

  if (cleaned.company) {
    // Company names should be reasonable length
    if (cleaned.company.length > 50) cleaned.company = cleaned.company.substring(0, 50);
    // Allow basic punctuation for company names
    cleaned.company = cleaned.company.replace(/[^a-zA-Z\s\.,\-&]/g, '');
  }

  if (cleaned.skills) {
    // Skills should be comma-separated, clean each skill
    cleaned.skills = cleaned.skills.split(',').map(skill => 
      skill.trim().replace(/[^a-zA-Z\s\-+#]/g, '').substring(0, 30)
    ).filter(skill => skill.length > 1).join(', ');
  }

  // 4. Heuristic corrections for common mapping errors
  // If fullName looks like a summary (long, contains keywords), swap with summary
  if (cleaned.fullName && cleaned.fullName.length > 50 &&
      (cleaned.fullName.toLowerCase().includes('experience') ||
       cleaned.fullName.toLowerCase().includes('professional') ||
       cleaned.fullName.toLowerCase().includes('skills'))) {
    if (!cleaned.summary || cleaned.summary.length < cleaned.fullName.length) {
      [cleaned.fullName, cleaned.summary] = [cleaned.summary, cleaned.fullName];
    }
  }

  // If jobTitle contains location keywords, and location is empty, move it
  if (cleaned.jobTitle && !cleaned.location &&
      (cleaned.jobTitle.toLowerCase().includes('city') ||
       cleaned.jobTitle.toLowerCase().includes('state') ||
       cleaned.jobTitle.toLowerCase().includes('country') ||
       cleaned.jobTitle.toLowerCase().includes(','))) {
    cleaned.location = cleaned.jobTitle;
    cleaned.jobTitle = '';
  }

  // If skills contains names or titles, it might be misassigned
  if (cleaned.skills && cleaned.skills.length > 100 &&
      (cleaned.skills.toLowerCase().includes('engineer') ||
       cleaned.skills.toLowerCase().includes('developer') ||
       cleaned.skills.toLowerCase().includes('manager'))) {
    if (!cleaned.jobTitle) {
      cleaned.jobTitle = cleaned.skills;
      cleaned.skills = '';
    }
  }

  // Clean LinkedIn URL
  if (cleaned.linkedinUrl) {
    cleaned.linkedinUrl = cleaned.linkedinUrl.trim();
    if (!cleaned.linkedinUrl.startsWith('http')) {
      cleaned.linkedinUrl = 'https://' + cleaned.linkedinUrl.replace(/^https?:\/\//, '');
    }
  }

  // 5. Strict validation for fullName: only alphabets and up to 3 spaces
  if (cleaned.fullName) {
    // Remove all non-alphabetic characters except spaces
    cleaned.fullName = cleaned.fullName.replace(/[^a-zA-Z\s]/g, '');
    // Replace multiple spaces with single space
    cleaned.fullName = cleaned.fullName.replace(/\s+/g, ' ').trim();
    // Count spaces - allow maximum 3 spaces (meaning up to 4 words)
    const spaceCount = (cleaned.fullName.match(/\s/g) || []).length;
    if (spaceCount > 3) {
      // Keep only first 4 words
      const words = cleaned.fullName.split(/\s+/);
      cleaned.fullName = words.slice(0, 4).join(' ');
    }
    // Final trim
    cleaned.fullName = cleaned.fullName.trim();
    if (cleaned.fullName.length < 2) cleaned.fullName = ''; // Too short
  }

  // 6. Check for at least ONE contact method (Email OR Phone OR LinkedIn)
  const hasEmail = !!cleaned.email;
  const hasPhone = !!cleaned.phone;
  const hasLinkedIn = cleaned.linkedinUrl && cleaned.linkedinUrl.trim().length > 0;

  if (!hasEmail && !hasPhone && !hasLinkedIn) return null; // No contact info -> Reject Row

  return cleaned;
};