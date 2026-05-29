import { compactText } from './text.js';

function includesTerm(haystack, term) {
  if (!term) return false;
  return haystack.includes(term.toLowerCase());
}

export function findMatchedKeywords(job, keywords) {
  const haystack = [
    job.jobTitle,
    job.descriptionSnippet,
    job.fullDescription,
    ...(job.skills || []),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  return (keywords || [])
    .map((keyword) => compactText(keyword))
    .filter(Boolean)
    .filter((keyword) => includesTerm(haystack, keyword));
}

export function calculateRelevanceScore(job, input) {
  const keywords = input.keywords || [];
  const sourceKeyword = compactText(job.sourceSearchKeyword || '');
  const title = compactText(job.jobTitle || '').toLowerCase();
  const description = compactText(`${job.descriptionSnippet || ''} ${job.fullDescription || ''}`).toLowerCase();
  const skills = (job.skills || []).join(' ').toLowerCase();

  let score = 20;

  if (sourceKeyword && title.includes(sourceKeyword.toLowerCase())) score += 28;
  if (sourceKeyword && description.includes(sourceKeyword.toLowerCase())) score += 18;
  if (sourceKeyword && skills.includes(sourceKeyword.toLowerCase())) score += 14;

  const matchedKeywords = findMatchedKeywords(job, keywords);
  score += Math.min(18, matchedKeywords.length * 6);

  if (input.jobType === 'both' || !input.jobType || job.jobType === input.jobType) score += 6;
  if (input.experienceLevel === 'all' || !input.experienceLevel || job.experienceLevel === input.experienceLevel) score += 6;

  if (input.minBudget !== null && input.minBudget !== undefined && job.fixedBudget !== null && job.fixedBudget >= input.minBudget) {
    score += 5;
  }

  if (input.maxBudget !== null && input.maxBudget !== undefined && job.fixedBudget !== null && job.fixedBudget <= input.maxBudget) {
    score += 5;
  }

  if (job.postedAt && /^\d{4}-\d{2}-\d{2}T/.test(job.postedAt)) {
    const ageHours = (Date.now() - new Date(job.postedAt).getTime()) / 36e5;
    if (Number.isFinite(ageHours)) {
      if (ageHours <= 24) score += 10;
      else if (ageHours <= 168) score += 5;
    }
  }

  return Math.max(0, Math.min(100, Math.round(score)));
}
