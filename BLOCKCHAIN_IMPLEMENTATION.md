# Blockchain Timestamping Implementation

## Overview

This implementation adds Bitcoin-backed cryptographic timestamping to the Truthtrollers evidence chain using OpenTimestamps protocol. Finalized evidence-chain records are cryptographically timestamped against Bitcoin-backed proofs, creating a tamper-evident audit trail.

## What Was Built

### 1. Database Schema: `claim_link_audit` Table

**Location:** `/backend/migrations/add_claim_link_audit_table.sql`

The audit table stores:
- Canonical JSON snapshots of claim_links
- SHA-256 hashes of snapshots
- OpenTimestamps proof data (binary .ots files)
- Bitcoin block numbers (after verification)
- Status tracking (pending → submitted → verified)

**Key Fields:**
```sql
- audit_id (PK)
- claim_link_id (FK to claim_links, unique)
- snapshot_json (TEXT) - Canonical JSON snapshot
- content_hash (VARCHAR 64) - SHA-256 hash
- ots_proof (LONGBLOB) - OpenTimestamps proof
- bitcoin_block (INT) - Bitcoin block height
- status (ENUM: pending, submitted, verified)
- finalized_at (TIMESTAMP)
- verified_at (TIMESTAMP)
- finalized_by_user_id (FK to users)
```

### 2. Canonical JSON Snapshot Function

**Location:** `/backend/src/utils/auditSnapshot.js`

Creates deterministic, order-independent JSON snapshots that produce consistent SHA-256 hashes.

**Key Functions:**
- `createClaimLinkSnapshot(claimLinkId)` - Fetches claim_link with all related data
- `toCanonicalJSON(obj)` - Converts object to canonical JSON (sorted keys)
- `generateHash(canonicalJSON)` - Generates SHA-256 hash
- `createAuditSnapshot(claimLinkId)` - Complete snapshot with hash
- `verifySnapshotHash(snapshot, claimedHash)` - Verifies hash matches snapshot

**Snapshot Structure:**
```javascript
{
  audit_version: "1.1",
  timestamp: "ISO-8601 timestamp",
  claim_link: { /* claim_link data */ },
  source_claim: {
    /* source claim data */
    content_sources: [
      {
        content_id,
        content_name,
        url,
        media_source,
        content_type,
        relationship_type,
        claim_role,
        claim_depth,
        claim_order,
        publishers,
        authors
      }
    ]
  },
  target_claim: {
    /* target claim data */
    content_sources: [ /* same shape as source_claim.content_sources */ ]
  }
}
```

### 3. OpenTimestamps Service

**Location:** `/backend/src/services/timestampService.js`

Handles Bitcoin blockchain timestamping and verification.

**Key Functions:**

- **`finalizeClaimLink(claimLinkId, userId)`**
  - Creates canonical snapshot and SHA-256 hash
  - Submits to OpenTimestamps calendars
  - Saves audit record with status 'submitted'
  - Returns audit record

- **`verifyTimestamp(auditId)`**
  - Retrieves OTS proof from database
  - Attempts to upgrade proof with Bitcoin confirmations
  - Updates status to 'verified' if confirmed
  - Extracts Bitcoin block height

- **`getAuditRecord(claimLinkId)`**
  - Fetches audit record for a claim_link
  - Returns snapshot, hash, status, and verification data

- **`getAuditRecords(options)`**
  - Lists all audit records with filtering
  - Options: status, limit, offset

- **`downloadOTSProof(auditId)`**
  - Downloads binary .ots proof file
  - Can be independently verified using OTS tools

### 4. API Endpoints

**Location:** `/backend/src/routes/audit/audit.routes.js`

**Endpoints:**

| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| POST | `/api/audit/finalize/:claimLinkId` | Finalize a claim_link and submit to Bitcoin blockchain | Yes |
| GET | `/api/audit/verify/:auditId` | Verify OTS proof against Bitcoin blockchain | No |
| GET | `/api/audit/claim-link/:claimLinkId` | Get audit record for a claim_link | No |
| GET | `/api/audit/records` | List all audit records (with filters) | No |
| GET | `/api/audit/download-proof/:auditId` | Download .ots proof file | No |

**Query Parameters for `/api/audit/records`:**
- `status`: Filter by status (pending, submitted, verified)
- `limit`: Max records to return (default 50)
- `offset`: Pagination offset (default 0)

### 5. Verify Record Page (Frontend)

**Location:** `/dashboard/src/pages/VerifyRecordPage.tsx`

**Route:** `/verify`

Public page for verifying blockchain timestamps.

**Features:**
- Search audit records by claim_link_id
- Display verification status with badges
- Show SHA-256 hash and Bitcoin block number
- Download .ots proof files
- Verify proofs against Bitcoin blockchain
- Expandable snapshot details with full JSON view
- Links to Bitcoin block explorer (blockstream.info)
- Educational information about OpenTimestamps

**Status Indicators:**
- 🟢 **Verified** - Confirmed in Bitcoin blockchain
- 🔵 **Pending Confirmation** - Submitted, awaiting Bitcoin confirmation (1-6 hours)
- 🟠 **Pending** - Hash created, not yet submitted

## Usage Guide

### Finalizing a Claim Link

**API Request:**
```bash
POST /api/audit/finalize/:claimLinkId
Authorization: Bearer <token>
```

**Example:**
```bash
curl -X POST https://localhost:5001/api/audit/finalize/123 \
  -H "Authorization: Bearer YOUR_TOKEN"
```

**Response:**
```json
{
  "success": true,
  "data": {
    "audit_id": 1,
    "claim_link_id": 123,
    "content_hash": "abc123...",
    "status": "submitted",
    "snapshot": { ... },
    "message": "Claim link finalized and submitted to Bitcoin blockchain via OpenTimestamps"
  }
}
```

### Verifying a Timestamp

**API Request:**
```bash
GET /api/audit/verify/:auditId
```

**Example:**
```bash
curl https://localhost:5001/api/audit/verify/1
```

**Response (Not Yet Confirmed):**
```json
{
  "success": true,
  "data": {
    "audit_id": 1,
    "verified": false,
    "status": "pending",
    "message": "Timestamp not yet confirmed in Bitcoin blockchain. Typically takes 1-6 hours."
  }
}
```

**Response (Verified):**
```json
{
  "success": true,
  "data": {
    "audit_id": 1,
    "verified": true,
    "status": "verified",
    "bitcoin_block": 850123,
    "verified_at": "2026-04-10T12:00:00.000Z",
    "message": "Timestamp verified in Bitcoin block 850123"
  }
}
```

### Viewing Audit Records

**Web Interface:**
Visit `/verify` and enter a claim_link_id to view its audit trail.

**API Request:**
```bash
GET /api/audit/claim-link/:claimLinkId
```

**Example:**
```bash
curl https://localhost:5001/api/audit/claim-link/123
```

### Downloading OTS Proof

**API Request:**
```bash
GET /api/audit/download-proof/:auditId
```

**Example:**
```bash
curl https://localhost:5001/api/audit/download-proof/1 \
  -o claim_link_1.ots
```

The downloaded `.ots` file can be independently verified using:
- [OpenTimestamps website](https://opentimestamps.org/)
- [ots-cli tool](https://github.com/opentimestamps/opentimestamps-client)

### Independent Verification

To verify a proof independently:

1. Download the .ots proof file
2. Save the original JSON snapshot
3. Use `ots verify` command:

```bash
# Install ots CLI
pip install opentimestamps-client

# Verify the proof
ots verify claim_link_1.ots
```

This proves the data existed at the timestamp without trusting Truthtrollers.

## Technical Details

### How OpenTimestamps Works

1. **Hash Creation:** SHA-256 hash is created from canonical JSON
2. **Submission:** Hash is submitted to OpenTimestamps calendar servers
3. **Merkle Tree:** Calendar servers aggregate multiple timestamps into a Merkle tree
4. **Bitcoin Anchoring:** Merkle root is embedded in Bitcoin transaction (OP_RETURN)
5. **Confirmation:** After Bitcoin block confirmation, proof is complete
6. **Verification:** Anyone can verify the proof independently using the .ots file

### Why Canonical JSON?

Normal JSON serialization is not deterministic - the same object can produce different strings. Canonical JSON:
- Sorts all keys alphabetically
- Uses consistent formatting
- Ensures same data → same hash every time
- Makes tampering detectable

**Example:**
```javascript
// Same data, different JSON strings
{"b": 2, "a": 1}  // One possible serialization
{"a": 1, "b": 2}  // Another possible serialization

// Canonical JSON (always the same)
{"a":1,"b":2}     // Deterministic output
```

### Security Model

**Tamper Evidence:**
- Any change to the snapshot data produces a completely different SHA-256 hash
- The hash is anchored to Bitcoin blockchain
- Changing historical data is immediately detectable
- This is evidence of later modification, not a mechanism that prevents bad input or manipulation attempts

**Trust Model:**
- Users don't need to trust Truthtrollers
- Bitcoin blockchain provides objective timestamp
- .ots proofs are independently verifiable
- OpenTimestamps is open-source and auditable

**What is NOT Protected:**
- This does not encrypt data
- This does not prevent initial data entry errors
- This does not independently prove that a claim is true
- This does not by itself prevent manipulation, brigading, or coordinated bad-faith submissions
- This only proves "data X existed at time T"

## Deployment Checklist

- [x] Database migration run (`claim_link_audit` table created)
- [x] OpenTimestamps package installed
- [x] Audit snapshot utility implemented
- [x] Timestamp service implemented
- [x] API routes registered in server.js
- [x] Verify Record page created
- [x] Route added to React Router
- [ ] Test finalization endpoint with real claim_link
- [ ] Wait for Bitcoin confirmation (1-6 hours) and test verification
- [ ] Add finalization UI to claim editing interface (optional)
- [ ] Add audit trail display to claim detail pages (optional)

## Future Enhancements

### Short Term
1. **Finalization UI** - Add "Finalize" button to claim_link editing interface
2. **Audit Trail Display** - Show audit status on claim detail pages
3. **Batch Finalization** - Finalize multiple claim_links at once
4. **Automated Verification** - Cron job to check pending proofs periodically

### Long Term
1. **Full Evidence Chain Snapshots** - Timestamp entire evidence chains, not just individual links
2. **Content Timestamping** - Timestamp original content sources
3. **Veracity Score Audit** - Timestamp AI-generated veracity scores
4. **Public Audit Log** - Public explorer for all timestamped records
5. **Certificate Generation** - Generate PDF certificates for verified records

## Marketing Copy

> "Finalized evidence-chain records are cryptographically timestamped against Bitcoin-backed proofs, creating a tamper-evident audit trail."

**Key Points:**
- 🔒 **Tamper-Evident** - Any change to data is immediately detectable
- ⛓️ **Bitcoin-Anchored** - Proofs secured by Bitcoin blockchain's hash power
- 🔍 **Independently Verifiable** - Anyone can verify proofs without trusting us
- 📜 **Anchored Audit Record** - Finalized snapshots can be compared against their anchored hash

## Files Created/Modified

### Backend
- `backend/migrations/add_claim_link_audit_table.sql` - Database schema
- `backend/src/utils/auditSnapshot.js` - Canonical JSON & hashing
- `backend/src/services/timestampService.js` - OpenTimestamps integration
- `backend/src/routes/audit/audit.routes.js` - API endpoints
- `backend/server.js` - Register audit routes (modified)
- `backend/package.json` - Added opentimestamp dependency (modified)

### Frontend
- `dashboard/src/pages/VerifyRecordPage.tsx` - Verification UI
- `dashboard/src/routes.tsx` - Added /verify route (modified)

## Testing

### Manual Testing Steps

1. **Finalize a Claim Link:**
   ```bash
   curl -X POST https://localhost:5001/api/audit/finalize/[CLAIM_LINK_ID] \
     -H "Authorization: Bearer [YOUR_TOKEN]"
   ```

2. **View Audit Record:**
   - Visit `/verify` in browser
   - Enter claim_link_id
   - View snapshot and status

3. **Wait for Confirmation:**
   - OpenTimestamps typically confirms in 1-6 hours
   - Depends on Bitcoin block time (~10 minutes average)

4. **Verify Proof:**
   - Click "Verify Now" button after 1-6 hours
   - Should show Bitcoin block number
   - Status should change to "Verified"

5. **Download Proof:**
   - Click "Download .ots Proof"
   - Verify independently using ots-cli

### API Testing with Postman/Insomnia

**Collection Examples:**

1. **POST Finalize Claim Link**
   - URL: `{{baseUrl}}/api/audit/finalize/123`
   - Headers: `Authorization: Bearer {{token}}`
   - Expected: 200 OK with audit_id and status 'submitted'

2. **GET Verify Timestamp**
   - URL: `{{baseUrl}}/api/audit/verify/1`
   - Expected: 200 OK with verification result

3. **GET Audit Record**
   - URL: `{{baseUrl}}/api/audit/claim-link/123`
   - Expected: 200 OK with full audit data

4. **GET All Records**
   - URL: `{{baseUrl}}/api/audit/records?status=verified&limit=10`
   - Expected: 200 OK with array of audit records

## Troubleshooting

### Common Issues

**Issue:** "Claim link already finalized"
- **Solution:** Each claim_link can only be finalized once (UNIQUE constraint)
- **Workaround:** Use a different claim_link_id

**Issue:** Verification shows "pending" for hours
- **Solution:** This is normal! Bitcoin blocks take ~10 minutes, calendar aggregation adds delay
- **Typical Time:** 1-6 hours from finalization to verification

**Issue:** Cannot connect to OpenTimestamps calendars
- **Check:** Internet connectivity
- **Check:** Firewall settings
- **Fallback:** OTS proof is saved locally; verification can be retried later

**Issue:** Downloaded .ots file won't verify
- **Check:** Did you wait for Bitcoin confirmation?
- **Check:** Are you verifying against the correct original data?
- **Try:** `ots info claim_link_1.ots` to see proof details

## Resources

- [OpenTimestamps Documentation](https://opentimestamps.org/)
- [OpenTimestamps GitHub](https://github.com/opentimestamps/opentimestamps-client)
- [Bitcoin Block Explorer](https://blockstream.info/)
- [Canonical JSON Specification](https://tools.ietf.org/html/rfc8785)
- [SHA-256 Hash Function](https://en.wikipedia.org/wiki/SHA-2)

## Support

For issues or questions:
- Check `/backend/logs/` for server errors
- Use browser dev console for frontend errors
- Test API endpoints with curl/Postman
- Verify database migration ran successfully
- Check OpenTimestamps calendar status at https://alice.btc.calendar.opentimestamps.org/

---

**Implementation Date:** April 10, 2026
**Status:** ✅ Complete and Ready for Testing
