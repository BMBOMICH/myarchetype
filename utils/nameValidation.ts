const BLOCKED_NAMES = [
  'test', 'admin', 'user', 'name', 'hello', 'hi',
  'sexy', 'hot', 'babe', 'daddy', 'mommy', 'baby',
  'ironman', 'batman', 'superman', 'spiderman',
  'princess', 'queen', 'king', 'prince',
  'anonymous', 'unknown', 'nobody', 'someone',
  'fuck', 'shit', 'ass', 'dick', 'pussy', 'bitch',
  'asdf', 'qwerty', 'abc', 'xyz', 'aaa', 'bbb',
];

export const validateName = (name: string): { valid: boolean; reason: string } => {
  const trimmed = name.trim();
  const lower = trimmed.toLowerCase();

  // Empty
  if (!trimmed) {
    return { valid: false, reason: 'Name is required' };
  }

  // Too short
  if (trimmed.length < 2) {
    return { valid: false, reason: 'Name must be at least 2 characters' };
  }

  // Too long
  if (trimmed.length > 20) {
    return { valid: false, reason: 'Name must be 20 characters or less' };
  }

  // Contains numbers
  if (/\d/.test(trimmed)) {
    return { valid: false, reason: 'Name cannot contain numbers' };
  }

  // Contains special characters (except hyphen and apostrophe for names like O'Brien, Mary-Jane)
  if (/[^a-zA-Z\s\-']/.test(trimmed)) {
    return { valid: false, reason: 'Name can only contain letters' };
  }

  // All same letter (aaa, bbb)
  if (/^(.)\1+$/.test(lower)) {
    return { valid: false, reason: 'Please enter a real name' };
  }

  // Blocked/fake names
  for (const blocked of BLOCKED_NAMES) {
    if (lower === blocked || lower.includes(blocked)) {
      return { valid: false, reason: 'Please use your real first name' };
    }
  }

  // All caps (SARAH) - except single letters
  if (trimmed.length > 1 && trimmed === trimmed.toUpperCase()) {
    return { valid: false, reason: 'Please use normal capitalization (e.g., Sarah)' };
  }

  // Starts with lowercase
  if (trimmed[0] !== trimmed[0].toUpperCase()) {
    return { valid: false, reason: 'Name should start with capital letter' };
  }

  return { valid: true, reason: '' };
};

export const formatName = (name: string): string => {
  const trimmed = name.trim();
  if (!trimmed) return '';
  
  // Capitalize first letter, lowercase rest
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1).toLowerCase();
};