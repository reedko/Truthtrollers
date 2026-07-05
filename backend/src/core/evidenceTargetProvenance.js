export function expandCandidateTargetAssignments(candidate = {}) {
  const occurrences = [
    {
      evidenceTargetId: candidate.evidenceTargetId || null,
      evidenceLaneId: candidate.evidenceLaneId || null,
      evidenceTargetType: candidate.evidenceTargetType || null,
      stanceGoal: candidate.stanceGoal || null,
      bearingRequirement: candidate.bearingRequirement || null,
      query: candidate.query || null,
    },
    ...(Array.isArray(candidate.targetProvenance) ? candidate.targetProvenance : []),
  ];
  const seen = new Set();
  const assignments = [];
  for (const occurrence of occurrences) {
    const targetId = Number(occurrence.evidenceTargetId) || null;
    const laneId = occurrence.evidenceLaneId || null;
    if (!targetId && !laneId) continue;
    const key = `${targetId || ""}:${laneId || ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    assignments.push({
      ...candidate,
      evidenceTargetId: targetId || occurrence.evidenceTargetId || null,
      evidenceLaneId: laneId,
      evidenceTargetType: occurrence.evidenceTargetType || candidate.evidenceTargetType || null,
      stanceGoal: occurrence.stanceGoal || candidate.stanceGoal || null,
      bearingRequirement: occurrence.bearingRequirement || candidate.bearingRequirement || null,
      query: occurrence.query || candidate.query || null,
    });
  }
  return assignments.length ? assignments : [candidate];
}
