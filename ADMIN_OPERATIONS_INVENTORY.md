# Admin and Operations Inventory

Generated from the current codebase on 2026-06-12.

This document summarizes what currently lives in the admin panel, what else behaves like an admin or operational function, and which concerns may be candidates for a separate operations surface.

## Entry Points

### Account menu

File: `dashboard/src/components/AccountMenu.tsx`

The account menu currently exposes:

- `Switch Viewer`: opens `UserSelectorModal`; used to view the app as another user/viewer context.
- `Account Settings`: `/account`.
- `Social Admin`: `/admin/social`; currently shown to all logged-in/non-demo users in the main menu, not only super admins.
- `Permissions`: `/permissions`; linked from the account menu, but no matching route/page is registered in `dashboard/src/routes.tsx`.
- `Admin Panel`: `/admin`; shown only when `user.role === "super_admin"`.
- `All Tools`: super-admin-only shortcut group with many normal app surfaces plus operational shortcuts. This group includes `/tutorials`, `/social-media`, `/ttlive`, `/evaluate-ratings`, `/admin/social`, and `/permissions`.

### Registered admin routes

File: `dashboard/src/routes.tsx`

- `/admin`: `AdminPanelPage`; protected by login and then gated in-page to `super_admin`.
- `/admin/social`: `SocialAdminPanel`; protected by login, but not gated in-page to `super_admin`.
- `/admin/publishers`: `PublisherSeedsPage`; protected by login and gated in-page to `super_admin`.

## Main Admin Panel

Frontend: `dashboard/src/pages/AdminPanelPage.tsx`
Backend: `backend/src/routes/admin/admin.routes.js`

Access: super-admin-only in frontend and backend for most `/api/admin/*` routes.

The main page is a tabbed super-admin console with these areas:

### User Operations

Frontend: `dashboard/src/components/admin/UserOpsPanel.tsx`

Functions:

- Platform stats: total users, total content, total claims, activity counts for last 24 hours and 7 days, top contributors.
- Online users: lists currently connected users using socket presence.
- Recent activity log: reads `user_activities`, filterable by activity type.
- Login attempts: reads recent successes/failures from `login_attempts`.
- Registration attempts: reads recent registrations from `registration_attempts`.
- Login events: reads login/logout/password-reset style events from `login_events`.
- User management: lists all users, their resolved roles, online state, and enabled status.
- Role management: changes a user's role among `user`, `admin`, and `super_admin`.
- Account enable/disable: toggles `users.enabled`.

Backend endpoints:

- `GET /api/admin/stats`
- `GET /api/admin/online-users`
- `GET /api/admin/recent-activities`
- `GET /api/admin/login-attempts`
- `GET /api/admin/registration-attempts`
- `GET /api/admin/login-events`
- `GET /api/admin/users`
- `GET /api/admin/roles`
- `PUT /api/admin/users/:userId/role`
- `PUT /api/admin/users/:userId/toggle-enabled`

### Evidence Operations

Frontend: `dashboard/src/components/admin/EvidenceOpsPanel.tsx`

Functions:

- Evidence search mode selection:
  - `high_quality_only`
  - `fringe_on_support`
  - `balanced_all_claims`
- Default claim extraction mode selection:
  - `edge`
  - `ranked`
  - `comprehensive`
- LLM prompt viewing/editing through `AdvancedPromptEditor` and `LLMPromptsEditor`.
- Configuration matrix view through `ConfigurationMatrix`.

Backend endpoints:

- `GET /api/evidence-config`: authenticated read.
- `PUT /api/evidence-config/mode`: super-admin-only write.
- `GET /api/extraction-mode/default`: currently public.
- `PUT /api/extraction-mode/default`: currently not authenticated or role-gated.
- `GET /api/extraction-modes`: currently public.
- `PUT /api/content/:contentId/extraction-mode`: currently not authenticated or role-gated.
- `POST /api/content/:contentId/re-extract`: currently not authenticated or role-gated.
- `GET /api/llm-prompts` and `GET /api/llm-prompts/:promptName`: currently public.
- `PUT /api/llm-prompts/:promptName/config`: currently not authenticated or role-gated.
- `GET /api/prompts`, `POST /api/prompts`, `PUT /api/prompts/:promptName/activate/:version`, `DELETE /api/prompts/:promptName/version/:version`, `POST /api/prompts/clear-cache`: currently not authenticated or role-gated.

Operational concern: this is global system behavior, not user support. It probably belongs in an operations/configuration console with stricter access, audit logs, and deployment/change controls.

### Extension Settings

Frontend: `dashboard/src/components/admin/ExtensionSettingsPanel.tsx`
Backend: `backend/src/routes/extension-settings.routes.js`

Functions:

- Reads extension settings.
- Updates individual extension settings.
- Bulk-updates extension settings.

Backend endpoints:

- `GET /api/extension-settings`: public.
- `GET /api/extension-settings/:key`: public.
- `PUT /api/extension-settings/:key`: super-admin-only.
- `POST /api/extension-settings/bulk-update`: super-admin-only.

### Claim Hierarchy

Frontend: `dashboard/src/components/admin/ClaimHierarchyEditor.tsx`
Backend: `backend/src/routes/admin/admin.routes.js`

Functions:

- Load a content item and its claims by content ID.
- Assign claim roles: `thesis`, `pillar`, `evidence`, `background`.
- Set parent claim IDs, depth, centrality score, verifiability score, and claim order.
- Save one claim hierarchy update.
- Save batch hierarchy updates.
- Ask the LLM to suggest hierarchy assignments.

Backend endpoints:

- `GET /api/admin/content/:contentId/claims-hierarchy`
- `PUT /api/admin/content/:contentId/claims/:claimId/hierarchy`
- `PUT /api/admin/content/:contentId/claims-hierarchy/batch`
- `POST /api/admin/content/:contentId/claims-hierarchy/suggest`

Operational concern: this is content/data repair tooling. It may belong with moderation/data-quality operations rather than with user/security admin.

## Admin Subpages

### Publisher Seed Data

Frontend: `dashboard/src/pages/PublisherSeedsPage.tsx`
Backend: `backend/src/routes/admin/seedData.routes.js`

Access: super-admin-only in frontend and backend.

Functions:

- View and edit publisher/bias/reliability seed datasets:
  - AllSides
  - MBFC
  - Ad Fontes
  - OpenSources
- Add or update single entries by domain.
- Delete entries by domain.
- Bulk-import JSON, replacing the source's seed data.

Backend endpoints:

- `GET /api/admin/seeds/:source`
- `POST /api/admin/seeds/:source/entry`
- `DELETE /api/admin/seeds/:source/entry`
- `POST /api/admin/seeds/:source/import`

Operational concern: this is reference-data stewardship. It is a distinct workflow from user administration.

### Social / X Admin

Frontend: `dashboard/src/pages/SocialAdminPanel.tsx`
Backend: `backend/src/routes/admin/x-credentials.routes.js`, `backend/src/routes/discussion/x-auth.routes.js`

Functions:

- Check whether X API credentials are configured.
- View stored X client ID and whether a secret exists.
- Save X client ID and secret to `system_config`.
- Test credential format.
- Delete stored X credentials.
- Connect/reconnect/disconnect a user X account through OAuth.
- View current X auth status and token expiry.

Backend endpoints:

- `GET /api/admin/x-credentials/status`
- `GET /api/admin/x-credentials`
- `POST /api/admin/x-credentials`
- `POST /api/admin/x-credentials/test`
- `DELETE /api/admin/x-credentials`
- `GET /api/x-auth/status`
- `GET /api/x-auth/connect`
- `DELETE /api/x-auth/disconnect`

Access note: the frontend page is not super-admin-gated, and the `/api/admin/x-credentials/*` endpoints only require authentication in the current file. Despite the `/api/admin` path, they do not check `req.user.role === "super_admin"`.

Operational concern: platform-level social API credentials are secrets/configuration and should probably be handled in a restricted operations area, while per-user X account connection can remain a user/account workflow.

## Other Admin-Type Functions Outside `/admin`

### Permanent content/task deletion

Frontend surface: super-admin item in `dashboard/src/components/TaskCard.tsx`
Backend: `backend/src/routes/content/deleteContent.routes.js`

Function:

- Permanently deletes a content/task record and cascades related records.
- Optional `includeReferences=true` deletes linked references as well.

Endpoint:

- `DELETE /api/delete-content/:contentId`

Access: backend verifies `super_admin` through DB role lookup.

### Permanent claim deletion

Backend: `backend/src/routes/claims/claims.routes.js`

Function:

- Permanently deletes claims and related link/rating/visibility/content-claim rows.

Endpoint:

- `DELETE /api/claims/permanent`

Access: super-admin-only.

### Permanent/admin reference deletion

Backend: `backend/src/routes/references/references.routes.js`

Functions:

- Permanently removes references from a task for everyone.
- Permission-based admin delete marks a relation as `globally_removed = TRUE`.

Endpoints:

- `DELETE /api/references/permanent`: super-admin-only.
- `DELETE /api/references/admin-delete`: requires `delete_system_references` permission, but the route does not attach `authenticateToken` at the endpoint itself.

Operational concern: destructive moderation/data-integrity functions are distributed across task/reference/claim screens rather than centralized under an operations model.

### Tutorial management

Frontend: `dashboard/src/pages/TutorialGalleryPage.tsx`
Backend: `backend/src/routes/tutorials/tutorials.routes.js`

Functions:

- Public/authenticated tutorial gallery.
- Super-admin upload of tutorial videos and thumbnails.
- Super-admin metadata edits.
- Super-admin thumbnail updates.
- Super-admin soft-delete.

Endpoints:

- `POST /api/tutorials/upload`
- `PUT /api/tutorials/:id`
- `PUT /api/tutorials/:id/thumbnail`
- `DELETE /api/tutorials/:id`

Operational concern: this is content management rather than platform administration.

### Permissions model

Backend: `backend/src/middleware/permissions.js`, `backend/src/routes/references/references.routes.js`
Frontend hook: `dashboard/src/hooks/usePermissions.ts`

Functions:

- Roles come from `roles` and `user_roles`.
- Permissions come from direct `user_permissions` and role-derived `role_permissions`.
- Frontend can fetch current user permissions from `GET /api/user/permissions`.
- `requirePermission(permissionName)` and `requireRole(roleName)` exist, but are not consistently used across all operational routes.

Access concern: `requirePermission` expects `req.user` to already exist, so routes using it should also include `authenticateToken` or be mounted behind authenticated middleware.

### Scope-based admin data views

Files include:

- `backend/src/routes/claims/claims.routes.js`
- `backend/src/routes/references/references.routes.js`
- `dashboard/src/pages/WorkspacePage.tsx`
- `dashboard/src/pages/KnowGraphPage.tsx`
- `dashboard/src/pages/GameSpacePage.tsx`
- `dashboard/src/pages/NewKnowGraphPage.tsx`

Several user-facing data views accept `scope=user|all|admin`. In `admin` scope, queries can include disabled/globally removed/creator metadata. These are admin-observability modes embedded in product screens rather than separate admin pages.

## Current Boundary Problems

- User/security administration, operational configuration, LLM prompt management, data repair, moderation/destructive deletes, seed-data stewardship, tutorial content management, and social API credential management are mixed under one account menu and a growing admin panel.
- Some functions are role-gated only in the frontend, some only in the backend, and some sensitive routes appear unauthenticated or merely authenticated.
- The `admin` role exists, but the main admin panel is really `super_admin`-only. The practical difference between `admin`, `super_admin`, and permission-based access is not clear in the UI.
- `/admin/social` is visible to regular authenticated users in the account menu, but it manages platform-level credentials.
- `/permissions` is linked but no registered route was found.
- Prompt and extraction-mode controls affect production behavior but are exposed through routes without clear role checks.
- Destructive operations are spread across task cards and API modules rather than gathered into a consistent moderation/operations workflow with auditability.

## Suggested Operational Grouping

A cleaner split would be to keep normal user/account concerns in the main app and move operational concerns into a separate console or at least a separate operations section with explicit modules:

- Identity and access: users, roles, permissions, account enable/disable, login/registration/security telemetry.
- Platform configuration: extension settings, evidence search modes, extraction defaults, feature flags, social API credentials.
- AI/pipeline operations: LLM prompts, prompt versions, cache clearing, extraction/re-extraction controls, evidence pipeline configuration.
- Data stewardship: publisher seed data, source quality/reference data, claim hierarchy repair.
- Moderation/data integrity: permanent task/claim/reference delete, globally removed references, admin scopes, disabled claim/link visibility.
- Content management: tutorials and other platform-owned help/media content.
- Integrations: X OAuth, X app credentials, future external API keys/providers.

The main app can still link into these areas, but operational functions should have a consistent access layer, backend route policy, audit logging, and navigation model rather than continuing to accumulate in the account menu.
