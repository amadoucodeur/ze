import type { ParsedCv } from "@/lib/cv/schema";

function clamp(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function hasMeaningful(value: string | null | undefined, minimum = 2) {
  return Boolean(value && value.trim().length >= minimum);
}

export function calculateProfileQuality(parsed: ParsedCv, sourceText: string): ParsedCv["performance"] {
  const lines = sourceText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const datedLines = lines.filter((line) => /\b(19|20)\d{2}\b/.test(line)).length;
  const bulletLines = lines.filter((line) => /^[-•▪◦*]/.test(line)).length;
  const headingLines = lines.filter((line) => line.length <= 60 && (/^[A-ZÀ-ÖØ-Þ\s/&-]{4,}$/.test(line) || /:$/.test(line))).length;
  const quantifiedEvidence = (sourceText.match(/\b\d+(?:[.,]\d+)?\s?(?:%|x|k|m|million|millions|clients?|projets?|personnes?|jours?|mois|ans?)\b/gi) || []).length;

  let completeness = 0;
  if (hasMeaningful(parsed.fullname)) completeness += 10;
  if (hasMeaningful(parsed.posteType)) completeness += 10;
  if (hasMeaningful(parsed.summary, 80)) completeness += 12;
  if (parsed.contacts.email || parsed.contacts.phone) completeness += 10;
  if (hasMeaningful(parsed.localisation)) completeness += 5;
  completeness += Math.min(20, parsed.skills.length * 2);
  completeness += Math.min(15, parsed.sections.filter((section) => ["experience", "responsibility", "achievement", "project"].includes(section.type)).length * 3);
  completeness += Math.min(10, parsed.formations.length * 5);
  completeness += Math.min(5, parsed.languages.length * 2);
  completeness += Math.min(3, parsed.industries.length);

  const presentationQuality = clamp(
    38
      + Math.min(18, headingLines * 3)
      + Math.min(15, bulletLines * 1.5)
      + (lines.length >= 12 ? 12 : lines.length)
      + (sourceText.length >= 800 && sourceText.length <= 15_000 ? 12 : sourceText.length > 30_000 ? -8 : 0)
      - (lines.filter((line) => line.length > 220).length * 2),
  );

  const clarity = clamp(
    42
      + (hasMeaningful(parsed.summary, 80) ? 16 : 0)
      + Math.min(18, headingLines * 3)
      + Math.min(14, datedLines * 2)
      + (parsed.posteType ? 10 : 0)
      - Math.min(15, parsed.pointsAttention.length * 3),
  );

  const evidenceQuality = clamp(
    30
      + Math.min(25, datedLines * 3)
      + Math.min(20, quantifiedEvidence * 4)
      + Math.min(15, parsed.sections.filter((section) => ["achievement", "project", "experience"].includes(section.type)).length * 3)
      + Math.min(10, parsed.skills.filter((skill) => skill.months || skill.expertise).length),
  );

  const consistency = clamp(96 - Math.min(45, parsed.pointsAttention.length * 8));
  const contentQuality = clamp(
    completeness * 0.32
      + clarity * 0.18
      + evidenceQuality * 0.30
      + consistency * 0.20,
  );
  const overall = clamp(
    contentQuality * 0.30
      + presentationQuality * 0.20
      + completeness * 0.15
      + clarity * 0.15
      + consistency * 0.10
      + evidenceQuality * 0.10,
  );

  return {
    overall,
    contentQuality,
    presentationQuality,
    completeness: clamp(completeness),
    clarity,
    consistency,
    evidenceQuality,
    strengths: parsed.performance.strengths,
    improvements: parsed.performance.improvements,
    evidence: parsed.performance.evidence,
  };
}
