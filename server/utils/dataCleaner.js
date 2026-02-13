// Data cleaning and validation utilities
export const cleanAndValidateCandidate = (data, options = {}) => {
  if (!data) return { valid: false, reason: 'EMPTY_DATA' };
  const cleaned = { ...data };
  const requireName = options.requireName !== false;
  const requireContact = options.requireContact !== false;
  const fallbackName = options.fallbackName ? String(options.fallbackName).trim() : '';

  // Helper: Capitalize first letter of each word (Title Case)
  const toTitleCase = (str) => {
    if (!str) return '';
    return str.toLowerCase().replace(/(?:^|\s|['"({])+[a-z]/g, (match) => match.toUpperCase());
  };

  // 1. Full Name: Alphabets only, max space gaps, Title Case
  if (cleaned.fullName) {
    // Remove non-alphabets (allow spaces)
    cleaned.fullName = cleaned.fullName.replace(/[^a-zA-Z\s]/g, '');
    // Normalize spaces (max space gaps)
    cleaned.fullName = cleaned.fullName.replace(/\s+/g, ' ').trim();
    
    // Keep names reasonably compact while avoiding aggressive truncation
    const words = cleaned.fullName.split(' ');
    if (words.length > 6) {
        cleaned.fullName = words.slice(0, 6).join(' ');
    }
    
    // Capitalize
    cleaned.fullName = toTitleCase(cleaned.fullName);
  }

  // 2. Job Title: Capitalize
  if (cleaned.jobTitle) {
    cleaned.jobTitle = cleaned.jobTitle.replace(/\s+/g, ' ').trim();
    cleaned.jobTitle = toTitleCase(cleaned.jobTitle);
  }

  // 3. Company Name: Capitalize
  if (cleaned.company) {
    // Keep common company characters (&, ., -, digits) to avoid data loss
    cleaned.company = cleaned.company.replace(/[^a-zA-Z0-9\s&.\-]/g, '');
    cleaned.company = cleaned.company.replace(/\s+/g, ' ').trim();
    cleaned.company = toTitleCase(cleaned.company);
  }

  // 4. Experience: Add ' Years' if missing
  if (cleaned.experience) {
    cleaned.experience = cleaned.experience.trim();
    
    // Strict: Only numbers or word 'years'
    // Strategy: Extract the first number found. If no number, clear it (prevents garbage text).
    const numberMatch = cleaned.experience.match(/(\d+(\.\d+)?)/);
    
    if (numberMatch) {
        cleaned.experience = `${numberMatch[0]} Years`;
    } else if (cleaned.experience.toLowerCase().includes('fresh')) {
        cleaned.experience = '0 Years';
    } else {
        // If no number and not fresher, it's likely garbage data (e.g. a Job Title shifted here)
        cleaned.experience = '';
    }
  }

  // 5. LinkedIn: Strict validation
  if (cleaned.linkedinUrl) {
    let url = cleaned.linkedinUrl.trim();
    // Must contain 'linkedin.com' to be valid
    if (url.toLowerCase().includes('linkedin.com')) {
        // Ensure protocol
        if (!url.startsWith('http')) {
            url = 'https://' + url.replace(/^https?:\/\//, '');
        }
        cleaned.linkedinUrl = url;
    } else {
        // Reject invalid LinkedIn URLs (fixes "https://male/" issue)
        cleaned.linkedinUrl = '';
    }
  }

  // 6. Mobile: Only numbers and +
  if (cleaned.phone) {
    // Remove all characters except digits and +
    cleaned.phone = cleaned.phone.replace(/[^0-9+]/g, '');
    // Basic validity check
    if (cleaned.phone.length < 7 || cleaned.phone.length > 15) {
        cleaned.phone = '';
    }
  }

  // 7. Location: Only alphabets, comma, fullstop
  if (cleaned.location) {
    cleaned.location = cleaned.location.replace(/[^a-zA-Z\s,.\-]/g, '').replace(/\s+/g, ' ').trim();
  }
  // Apply same to locality/country
  if (cleaned.locality) cleaned.locality = cleaned.locality.replace(/[^a-zA-Z\s,.\-]/g, '').trim();
  if (cleaned.country) cleaned.country = cleaned.country.replace(/[^a-zA-Z\s,.\-]/g, '').trim();

  // 8. Skills: Remove emails, fix formatting
  if (cleaned.skills) {
    const skillsArr = cleaned.skills.split(',');
    const validSkills = [];
    
    for (let s of skillsArr) {
        s = s.trim();
        if (!s) continue;
        
        // Check if it looks like an email (contains @ and .) -> Reject
        if (s.includes('@') && s.includes('.')) continue;
        
        // Check if it looks like a URL -> Reject
        if (s.includes('http') || s.includes('www.')) continue;

        validSkills.push(s);
    }
    cleaned.skills = validSkills.join(', ');
  }

  // 9. Email Validation
  if (cleaned.email) {
      cleaned.email = cleaned.email.trim();
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(cleaned.email)) {
          cleaned.email = ''; 
      }
  }

  // 10. Core Information Check
  const hasName = cleaned.fullName && cleaned.fullName.trim().length > 2;

  if (!hasName) {
    if (requireName) {
      return { valid: false, reason: 'MISSING_NAME' };
    }
    cleaned.fullName = fallbackName || 'Unknown Candidate';
  }

  // Requirement: Must have at least one contact method (LinkedIn, Email, or Phone)
  const hasEmail = !!cleaned.email;
  const hasPhone = !!cleaned.phone;
  const hasLinkedIn = cleaned.linkedinUrl && cleaned.linkedinUrl.trim().length > 0;

  if (requireContact && !hasEmail && !hasPhone && !hasLinkedIn) {
    return { valid: false, reason: 'NO_CONTACT_INFO' };
  }

  return { valid: true, data: cleaned };
};
