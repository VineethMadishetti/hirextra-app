// Data cleaning and validation utilities
export const cleanAndValidateCandidate = (data) => {
  if (!data) return null;
  const cleaned = { ...data };

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
    cleaned.company = cleaned.company.replace(/\s+/g, ' ').trim();
    cleaned.company = toTitleCase(cleaned.company);
  }

  // 4. Experience: Add ' Years' if missing
  if (cleaned.experience) {
    cleaned.experience = cleaned.experience.trim();
    // Garbage check: if it looks like a URL (LinkedIn in experience), clear it
    if (cleaned.experience.includes('http') || cleaned.experience.includes('www.') || cleaned.experience.includes('.com')) {
        cleaned.experience = '';
    } else if (cleaned.experience) {
        // Check for 'year', 'years', 'yr', 'yrs' (case insensitive)
        if (!/years?|yrs?/i.test(cleaned.experience)) {
            // Only add if it looks like a number or duration
            if (/\d/.test(cleaned.experience)) {
                 cleaned.experience = `${cleaned.experience} Years`;
            }
        }
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
    cleaned.location = cleaned.location.replace(/[^a-zA-Z\s,.]/g, '').replace(/\s+/g, ' ').trim();
  }
  // Apply same to locality/country
  if (cleaned.locality) cleaned.locality = cleaned.locality.replace(/[^a-zA-Z\s,.]/g, '').trim();
  if (cleaned.country) cleaned.country = cleaned.country.replace(/[^a-zA-Z\s,.]/g, '').trim();

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

  // 10. Contact Method Check
  const hasEmail = !!cleaned.email;
  const hasPhone = !!cleaned.phone;
  const hasLinkedIn = cleaned.linkedinUrl && cleaned.linkedinUrl.trim().length > 0;

  if (!hasEmail && !hasPhone && !hasLinkedIn) return null; // No contact info -> Reject Row

  return cleaned;
};