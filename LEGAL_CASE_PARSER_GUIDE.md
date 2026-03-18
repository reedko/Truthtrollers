# Legal Case Parser - User Guide

## Overview

The Legal Case Parser extracts **readable, human-friendly information** from CourtListener pages, giving you the actual case details instead of just metadata.

## What It Does

### Before (Old System):
```json
{
  "case_name": "Smith v. Jones",
  "court": "ca9",
  "snippet": "...some text fragment..."
}
```

### After (New System):
```json
{
  "case_name": "Smith v. Jones",
  "case_level": "docket",
  "case_type": "civil",

  "complaint": {
    "date": "2023-01-15",
    "description": "Complaint for Defamation",
    "document_url": "https://..."
  },

  "verdict": {
    "date": "2024-03-20",
    "description": "Jury Verdict - Plaintiff awarded $500,000",
    "document_url": "https://..."
  },

  "judgment": {
    "date": "2024-04-01",
    "description": "Final Judgment - Damages confirmed",
    "document_url": "https://..."
  },

  "readable_summary": "**Smith v. Jones**\n\n**Nature of Suit:** Tort - Defamation\n\n**Complaint Filed:** 2023-01-15 - Complaint for Defamation\n\n**Verdict:** 2024-03-20 - Jury Verdict - Plaintiff awarded $500,000\n\n**Judgment:** 2024-04-01 - Final Judgment - Damages confirmed"
}
```

## Page Types

The parser identifies and handles different CourtListener page types:

### 1. Opinion Pages (`/opinion/123456/`)
**What it is:** Appellate court decisions (Appeals, Supreme Court)

**What you get:**
- `case_level`: "opinion"
- `procedural_history`: Background of the case
- `syllabus`: Court's summary of the case
- `disposition`: "Affirmed", "Reversed", "Remanded", etc.
- `opinion_text`: Full text of the decision
- `author`: Judge who wrote the opinion
- `judges`: Panel of judges

**Example:**
```
"An appellate court opinion explaining why the lower court's decision was upheld or overturned"
```

### 2. Docket Pages (`/docket/12345678/`)
**What it is:** Complete case file with all filings

**What you get:**
- `case_level`: "docket"
- `parties`: List of plaintiffs, defendants, attorneys
- `nature_of_suit`: What the case is about
- `cause`: Legal basis for the lawsuit
- `complaint`: The initial filing ("Dude A suing Dude B")
- `verdict`: What the jury decided
- `judgment`: What the judge ordered
- `docket_entries`: All filings in chronological order

**Example:**
```
"The complete case file showing who sued whom, why, and what happened"
```

### 3. Filing Pages (`/recap/...`)
**What it is:** Individual documents (complaints, motions, orders)

**Status:** Coming soon

## Case Types

The parser automatically classifies cases:

- **`criminal`**: United States v. [Person] - Crimes, prosecutions
- **`civil`**: [Person] v. [Person/Org] - Lawsuits, disputes
- **`habeas`**: Prisoner petitions challenging detention
- **`bankruptcy`**: Debt restructuring, liquidation

## API Endpoint

### `POST /api/credibility/legal-case/details`

**Request:**
```json
{
  "caseUrl": "https://www.courtlistener.com/docket/12345678/smith-v-jones/"
}
```

**Response:**
```json
{
  "success": true,
  "page_type": {
    "type": "docket",
    "level": "trial",
    "description": "Case docket with all filings"
  },
  "case_level": "docket",
  "case_type": "civil",
  "case_name": "Smith v. Jones",
  "court": "nysd",
  "date_filed": "2023-01-15",
  "docket_number": "1:23-cv-00123",

  "parties": [
    {
      "name": "John Smith",
      "type": "Plaintiff",
      "attorneys": ["Jane Lawyer, Esq."]
    },
    {
      "name": "Bob Jones",
      "type": "Defendant",
      "attorneys": ["Mike Attorney, Esq."]
    }
  ],

  "nature_of_suit": "440 Other Civil Rights",
  "cause": "42:1983 Civil Rights Act",

  "complaint": {
    "entry_number": 1,
    "date": "2023-01-15",
    "description": "Complaint",
    "document_url": "https://www.courtlistener.com/..."
  },

  "verdict": {
    "entry_number": 45,
    "date": "2024-03-20",
    "description": "Jury Verdict Form",
    "document_url": "https://www.courtlistener.com/..."
  },

  "judgment": {
    "entry_number": 46,
    "date": "2024-04-01",
    "description": "Final Judgment",
    "document_url": "https://www.courtlistener.com/..."
  },

  "docket_entries": [
    // All 20+ filings
  ],

  "disposition_source": "docket_entry",
  "url": "https://www.courtlistener.com/docket/12345678/smith-v-jones/",

  "readable_summary": "**Smith v. Jones**\n\n**Nature of Suit:** 440 Other Civil Rights\n\n**Cause:** 42:1983 Civil Rights Act\n\n**Complaint Filed:** 2023-01-15 - Complaint\n\n**Verdict:** 2024-03-20 - Jury Verdict Form\n\n**Judgment:** 2024-04-01 - Final Judgment"
}
```

## Usage Example

### From Dashboard:

```typescript
// When user clicks on a legal case result
async function viewCaseDetails(caseUrl: string) {
  const response = await fetch('/api/credibility/legal-case/details', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ caseUrl })
  });

  const details = await response.json();

  if (details.success) {
    // Display readable summary to user
    console.log(details.readable_summary);

    // Or show structured data
    if (details.complaint) {
      console.log('Complaint:', details.complaint.description);
    }
    if (details.verdict) {
      console.log('Verdict:', details.verdict.description);
    }
    if (details.judgment) {
      console.log('Judgment:', details.judgment.description);
    }
  }
}
```

## Fields Explained

### `case_level`
- `opinion`: Appellate decision document
- `docket`: Full case file with all filings
- `filing`: Individual document

### `case_type`
- `criminal`: Government prosecution
- `civil`: Private lawsuit
- `habeas`: Prisoner petition
- `bankruptcy`: Debt case

### `disposition_source`
- `opinion_text`: Decision comes from appellate opinion
- `docket_entry`: Decision comes from trial court filing
- `judgment_pdf`: Decision comes from judgment document

### `nature_of_suit`
Federal court category (e.g., "440 Other Civil Rights", "550 Prisoner - Civil Rights")

### `cause`
Legal basis for the case (e.g., "42:1983 Civil Rights Act", "28:1331 Fed. Question")

## What Gets Extracted

### From Opinions:
- ✅ Case summary (syllabus)
- ✅ Procedural history
- ✅ Decision (affirmed/reversed/remanded)
- ✅ Judge who wrote it
- ✅ Full opinion text

### From Dockets:
- ✅ All parties (plaintiffs, defendants, attorneys)
- ✅ What the suit is about (nature of suit)
- ✅ Legal cause of action
- ✅ **The complaint** ("Dude A suing Dude B because...")
- ✅ **The verdict** ("Jury says...")
- ✅ **The judgment** ("Judge orders...")
- ✅ All docket entries (motions, orders, filings)

## Setup

### Required Environment Variable:

```bash
COURTLISTENER_API_TOKEN=your_token_here
```

Get a free token at: https://www.courtlistener.com/api/rest-info/

## Future Enhancements

### Phase 2:
- [ ] Parse individual filing documents (`/recap/...`)
- [ ] Extract text from PDF documents
- [ ] OCR for scanned documents
- [ ] Parse party role types (lead plaintiff, intervenor, etc.)

### Phase 3:
- [ ] Semantic search within case documents
- [ ] Citation extraction and linking
- [ ] Timeline visualization
- [ ] Outcome prediction based on filings

## Testing

### Test with a real docket:

```bash
curl -X POST https://localhost:5001/api/credibility/legal-case/details \
  -H "Authorization: Bearer YOUR_JWT" \
  -H "Content-Type: application/json" \
  -d '{
    "caseUrl": "https://www.courtlistener.com/docket/4214664/1/securities-and-exchange-commission-v-ripple-labs-inc/"
  }'
```

This will return the full SEC v. Ripple case with:
- Complaint: SEC suing Ripple for securities violations
- Judgment: Court's ruling on summary judgment
- All 500+ docket entries

## Summary

**Old system:** Just case names and snippets

**New system:** Readable summaries with:
- Who sued whom and why (complaint)
- What the jury decided (verdict)
- What the judge ordered (judgment)
- Full case documents

Perfect for showing users "This person/organization has legal issues, here's what actually happened."
