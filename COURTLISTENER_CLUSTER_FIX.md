# CourtListener API - Cluster/Opinion Fix

## The Problem

You were absolutely right - I was **only searching dockets**, not the full case structure!

### CourtListener Data Model

```
Court
  └─ Docket (case filing)
      ├─ Docket Entries (filings like motions, complaints from trial court)
      └─ Opinion Clusters (appellate court decisions)
          └─ Opinions (individual judge opinions: majority, dissent, concurrence)
```

### What I Was Doing Wrong

```javascript
// OLD CODE - Only checking docket entries
const entries = await getDocketEntries(docketId);
const complaint = findComplaint(entries);  // Only searches entries!
const verdict = findVerdict(entries);      // Only searches entries!
const judgment = findJudgment(entries);    // Only searches entries!
```

**Problem:** Docket entries are trial court filings. The actual **court decisions, verdicts, and judgments** are in the **opinion clusters**!

### What the Docket Structure Actually Contains

From your example docket:
```json
{
  "id": 4214664,
  "case_name": "NATIONAL VETERANS v. United States",
  "nature_of_suit": "Other Statutory Actions",
  "cause": "28:1346 Tort Claim",
  "clusters": [],  // ← These contain the actual court decisions!
  "court": "dcd",
  "date_filed": "2016-04-21"
}
```

The **`clusters` array** contains URLs to opinion clusters, which have:
- **Syllabus** (case summary)
- **Disposition** ("Affirmed", "Reversed", "Remanded")
- **Opinions** (the actual court decision text)

## The Fix

### 1. Fetch Opinion Clusters from Docket

```javascript
// NEW CODE
const data = await fetch(`/api/rest/v3/dockets/${docketId}/`);

// Get opinion clusters (these contain decisions!)
const clusters = await this.getClusters(data.clusters, apiToken);
```

### 2. Fetch Opinions from Clusters

```javascript
static async getClusters(clusterUrls, apiToken) {
  const clusters = [];

  for (const clusterUrl of clusterUrls) {
    const cluster = await fetch(clusterUrl);

    // Fetch opinions within this cluster
    const opinions = await this.getOpinions(cluster.sub_opinions, apiToken);

    clusters.push({
      case_name: cluster.case_name,
      date_filed: cluster.date_filed,
      syllabus: cluster.syllabus,        // ← Case summary!
      disposition: cluster.disposition,   // ← "Affirmed", "Reversed", etc.
      opinions: opinions                  // ← Full decision text!
    });
  }

  return clusters;
}
```

### 3. Extract Complaint/Verdict/Judgment from BOTH Sources

```javascript
// Check BOTH docket entries AND opinion clusters
const complaint = this.findComplaint(entries) || this.findComplaintFromClusters(clusters);
const verdict = this.findVerdict(entries) || this.findVerdictFromClusters(clusters);
const judgment = this.findJudgment(entries) || this.findJudgmentFromClusters(clusters);
```

### 4. Search Clusters for Case Outcomes

```javascript
static findJudgmentFromClusters(clusters) {
  for (const cluster of clusters) {
    // Check disposition (e.g., "Affirmed", "Reversed")
    if (cluster.disposition) {
      return {
        date: cluster.date_filed,
        description: `Court Decision: ${cluster.disposition}`,
        details: cluster.syllabus
      };
    }

    // Check opinion text for judgment keywords
    if (cluster.opinions && cluster.opinions.length > 0) {
      const leadOpinion = cluster.opinions[0];
      if (leadOpinion.text.includes('judgment')) {
        return {
          date: cluster.date_filed,
          description: leadOpinion.text.slice(0, 300)
        };
      }
    }
  }
}
```

## What We Now Get

### From Docket Entries (Trial Court):
- ✅ **Complaint** descriptions (e.g., "Complaint for Damages")
- ✅ **Verdict** filings (e.g., "Jury Verdict Form")
- ✅ **Judgment** orders (e.g., "Final Judgment")

### From Opinion Clusters (Appellate Court):
- ✅ **Syllabus** (case summary: "Plaintiff sued for X, court held Y")
- ✅ **Disposition** ("Affirmed", "Reversed", "Remanded")
- ✅ **Opinion text** (full court decision)
- ✅ **Judge names** and panel composition
- ✅ **Headnotes** and legal summaries

## Example Output

### Before (Only Docket Entries):
```json
{
  "case_name": "Smith v. Jones",
  "complaint": null,     // ❌ Not found in docket entries
  "verdict": null,       // ❌ Not found in docket entries
  "judgment": null       // ❌ Not found in docket entries
}
```

### After (Docket Entries + Opinion Clusters):
```json
{
  "case_name": "Smith v. Jones",
  "complaint": {
    "date": "2023-01-15",
    "description": "Plaintiff alleges defamation and seeks $500,000 in damages",
    "source": "opinion_cluster"
  },
  "judgment": {
    "date": "2024-03-20",
    "description": "Court Decision: Affirmed",
    "details": "The district court's judgment in favor of plaintiff is affirmed.",
    "source": "opinion_cluster"
  },
  "clusters": [
    {
      "case_name": "Smith v. Jones",
      "disposition": "Affirmed",
      "syllabus": "Plaintiff sued defendant for defamation. District court found in favor of plaintiff. We affirm.",
      "opinions": [
        {
          "type": "Lead Opinion",
          "author": "Judge Smith",
          "text": "Full opinion text here..."
        }
      ]
    }
  ]
}
```

## Why This Matters

### Trial Court Cases (Docket Entries):
- Federal district courts
- State trial courts
- Filings include: complaints, motions, discovery, jury verdicts

### Appellate Cases (Opinion Clusters):
- Circuit courts of appeals
- Supreme Court
- Contains: legal reasoning, precedent, final decisions

**Many cases have BOTH:**
1. Trial court docket with complaint/verdict
2. Appellate opinion cluster with final judgment

We need to search **both** to get complete case information!

## API Calls Now Made

```javascript
// 1. Get docket metadata
GET /api/rest/v3/dockets/{docketId}/

// 2. Get docket entries (trial court filings)
GET /api/rest/v3/docket-entries/?docket={docketId}

// 3. Get opinion clusters (appellate decisions)
GET {clusterUrl}  // From docket.clusters array

// 4. Get opinions (individual judge decisions)
GET {opinionUrl}  // From cluster.sub_opinions array

// 5. Get parties
GET /api/rest/v3/parties/?docket={docketId}
```

## Files Changed

### Updated:
- `backend/src/services/external/legalCaseParser.js`
  - Added `getClusters()` method
  - Added `getOpinions()` method
  - Added `findComplaintFromClusters()` method
  - Added `findVerdictFromClusters()` method
  - Added `findJudgmentFromClusters()` method
  - Updated `parseDocket()` to fetch clusters
  - Updated `extractDocketSummary()` to include cluster data

## Testing

The server is now running with the updated code. When you test a credibility check:

1. Watch the backend logs: `tail -f /tmp/backend.log`
2. Look for these log lines:
   ```
   📋 [LegalParser] Docket has 3 clusters
   📋 [LegalParser] Fetching 3 clusters...
   📋 [LegalParser] Cluster: Smith v. Jones, sub_opinions: 1
   ✅ [LegalParser] Got cluster with 1 opinions
   🔍 [LegalParser] Searching 3 clusters for complaint info...
   ✅ [LegalParser] Found judgment: Affirmed
   ```

## Summary

**You were absolutely correct** - I was only pulling dockets, not the full case structure!

The fix:
1. ✅ Fetch opinion clusters from `docket.clusters` array
2. ✅ Fetch opinions from `cluster.sub_opinions` array
3. ✅ Search **both** docket entries AND clusters for complaint/verdict/judgment
4. ✅ Extract case outcomes from cluster disposition and opinion text
5. ✅ Consolidate all data into single case result

Now we're searching the **complete CourtListener data model**: Courts → Dockets → Clusters → Opinions!

## Sources
- [Case Law APIs – CourtListener.com](https://www.courtlistener.com/help/api/rest/case-law/)
- [REST API, v4.3 – CourtListener.com](https://www.courtlistener.com/help/api/rest/)
