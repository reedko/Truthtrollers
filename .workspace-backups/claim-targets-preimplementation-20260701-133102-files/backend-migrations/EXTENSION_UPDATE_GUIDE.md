# Extension Update Guide - New Completion System

## Required Changes to `extension/src/background.js`

### Change 1: Get User ID for Completion Check

In the `checkContentAndUpdatePopup` function (around line 1110), update the API call to include userId:

**BEFORE:**
```javascript
const response = await fetch(`${BASE_URL}/api/check-content`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ url: checkUrl }),
});
```

**AFTER:**
```javascript
// Get current user ID from storage
const userStorage = await browser.storage.local.get('currentUser');
const userId = userStorage?.currentUser?.user_id || null;

const response = await fetch(`${BASE_URL}/api/check-content`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    url: checkUrl,
    userId: userId  // NEW - pass user ID
  }),
});
```

### Change 2: Use API Response for Completion Status

Around line 1140-1142, update how `isCompleted` is determined:

**BEFORE:**
```javascript
const isDetected = data.exists;
// Check if content is "completed" - for now, just use exists
// TODO: Properly implement progress tracking
const isCompleted = data.exists; // Simplified: if it exists in DB, it's been processed
```

**AFTER:**
```javascript
const isDetected = data.exists;
// Use per-user completion status from API
const isCompleted = data.isCompleted || false; // NEW - from content_users.completed_at
```

### Change 3: Log Completion Status

Update the logging around line 1147:

**BEFORE:**
```javascript
if (data.exists) {
  console.log(`🔍 [checkContent] Task exists, progress field: ${data.task?.progress || 'NONE'}`);
}
```

**AFTER:**
```javascript
if (data.exists) {
  console.log(`🔍 [checkContent] Task exists, isCompleted: ${data.isCompleted}, progress: ${data.task?.progress || 'NONE'}`);
}
```

### Change 4: Update Similar Code in `syncTaskStateForUrl`

Around line 56-66, make the same changes:

**BEFORE:**
```javascript
const resp = await fetch(`${BASE_URL}/api/check-content`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ url: checkUrl }),
});

const data = await resp.json();
if (data.exists) {
  isDetected = true;
  isCompleted = true; // Simplified: if it exists in DB, it's been processed
  task = data.task;
  matchedUrl = checkUrl;
  console.log(`✅ [syncTaskState] Found task at URL: ${checkUrl}, progress: ${data.task?.progress || 'NONE'}`);
  break;
}
```

**AFTER:**
```javascript
// Get current user ID
const userStorage = await browser.storage.local.get('currentUser');
const userId = userStorage?.currentUser?.user_id || null;

const resp = await fetch(`${BASE_URL}/api/check-content`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    url: checkUrl,
    userId: userId  // NEW
  }),
});

const data = await resp.json();
if (data.exists) {
  isDetected = true;
  isCompleted = data.isCompleted || false; // NEW - use API response
  task = data.task;
  matchedUrl = checkUrl;
  console.log(`✅ [syncTaskState] Found task at URL: ${checkUrl}, isCompleted: ${isCompleted}, progress: ${data.task?.progress || 'NONE'}`);
  break;
}
```

## Testing the Changes

1. **Login to extension** - Make sure user is authenticated
2. **Mark a task complete** from the dashboard
3. **Visit the URL** for that completed task
4. **Verify overlay shows** - Extension should detect completion and show overlay
5. **Check console logs** - Should show `isCompleted: true`

## Expected Behavior

### When User Has NOT Completed Task:
```
Response: { exists: true, task: {...}, isCompleted: false }
→ Overlay does NOT show automatically
→ Only shows when user clicks extension icon
```

### When User HAS Completed Task:
```
Response: { exists: true, task: {...}, isCompleted: true }
→ Overlay SHOWS automatically
→ User can review their completed work
```

## Notes

- The extension now respects **per-user completion** status
- Multiple users can have different completion states for the same task
- The `content.progress` field is still available for backwards compatibility
- If userId is not provided, `isCompleted` defaults to false (safer behavior)
