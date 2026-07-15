const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();

function identity(work) {
  return clean(work.mentionText).toLowerCase().replace(/^(?:a|an|the)\s+/, "")
    .replace(/[^a-z0-9]+/g, "");
}

function mentionWords(work) {
  const ignored = new Set(["study", "studies", "report", "review", "the", "and", "other"]);
  return new Set(clean(work.mentionText).toLowerCase().match(/[a-z0-9]{3,}/g)
    ?.filter((word) => !ignored.has(word)) ?? []);
}

function sameWork(left, right) {
  if (identity(left) === identity(right)) return true;
  const shared = [...mentionWords(left)].some((word) => mentionWords(right).has(word));
  if (left.citationCallout && left.citationCallout === right.citationCallout && shared) return true;
  return left.workType === "study_group" && right.workType === "study_group" && shared
    && (!left.citationCallout || !right.citationCallout);
}

function sourceOrder(work) {
  return Math.min(...work.sourceUnitIds.map((id) => Number(String(id).replace(/\D/g, "")) || 999999));
}

function validCallout(value) {
  const normalized = clean(value).replace(/[—–]/g, "-");
  return /^\d+(?:-\d+)?$/.test(normalized) ? normalized : null;
}

function normalizedWork(work) {
  return {
    mentionText: clean(work.mentionText).slice(0, 300),
    workType: work.workType,
    citationCallout: validCallout(work.citationCallout),
    source: "text_mention",
    confidence: work.confidence,
    sourceUnitIds: [...new Set(work.sourceUnitIds)].sort(),
    linkResolved: false,
    year: work.year ?? null,
    peopleOrOrganizations: [...new Set(work.peopleOrOrganizations ?? [])],
    identifiers: [...new Set(work.identifiers ?? [])],
  };
}

/** Build the immutable, host-owned inventory exposed to Call 2 by stable IDs. */
export function buildNamedWorkPool(works = []) {
  const pool = [];
  for (const raw of works) {
    const work = normalizedWork(raw);
    if (!work.mentionText || !work.sourceUnitIds.length) continue;
    const existing = pool.find((item) => sameWork(item, work));
    if (!existing) pool.push(work);
    else {
      existing.sourceUnitIds = [...new Set([...existing.sourceUnitIds, ...work.sourceUnitIds])].sort();
      existing.citationCallout ??= work.citationCallout;
      if (work.confidence === "high") existing.confidence = "high";
      existing.year ??= work.year;
      existing.peopleOrOrganizations = [...new Set([...existing.peopleOrOrganizations,
        ...work.peopleOrOrganizations])];
      existing.identifiers = [...new Set([...existing.identifiers, ...work.identifiers])];
    }
  }
  return pool.sort((a, b) => sourceOrder(a) - sourceOrder(b)
    || a.mentionText.localeCompare(b.mentionText))
    .map((work, index) => ({ namedWorkId: `NW${String(index + 1).padStart(3, "0")}`, ...work }));
}
