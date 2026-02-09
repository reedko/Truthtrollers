// Service for molecule views API
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "https://localhost:5001";

export type DisplayMode = 'mr_cards' | 'circles' | 'compact';

export interface MoleculeView {
  id: number;
  user_id: number;
  content_id: number;
  name: string;
  is_default: boolean;
  display_mode: DisplayMode;
  positions?: Record<string, { x: number; y: number }> | null;
  node_settings?: Record<string, { displayMode: DisplayMode }> | null;
  last_viewed_at: string | null;
  created_at: string;
  updated_at: string;
  pins: Array<{
    reference_content_id: number;
    is_pinned: boolean;
  }>;
}

export interface CreateViewRequest {
  contentId: number;
  name: string;
  userId: number;
  isDefault?: boolean;
  displayMode?: DisplayMode;
}

export interface UpdateViewRequest {
  name?: string;
  isDefault?: boolean;
  displayMode?: DisplayMode;
  positions?: Record<string, { x: number; y: number }>;
  nodeSettings?: Record<string, { displayMode: DisplayMode }>;
  userId: number;
}

export interface UpdatePinRequest {
  referenceContentId: number;
  isPinned: boolean;
}

/**
 * Get all views for a specific content/task
 */
export async function getMoleculeViews(contentId: number, userId: number): Promise<MoleculeView[]> {
  const response = await fetch(`${API_BASE_URL}/api/molecule-views/${contentId}?userId=${userId}`, {
    credentials: "include",
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch views: ${response.statusText}`);
  }

  return response.json();
}

/**
 * Create a new view/tab
 */
export async function createMoleculeView(data: CreateViewRequest): Promise<MoleculeView> {
  const response = await fetch(`${API_BASE_URL}/api/molecule-views`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    credentials: "include",
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    throw new Error(`Failed to create view: ${response.statusText}`);
  }

  return response.json();
}

/**
 * Update a view (rename or change default)
 */
export async function updateMoleculeView(
  viewId: number,
  data: UpdateViewRequest
): Promise<MoleculeView> {
  const response = await fetch(`${API_BASE_URL}/api/molecule-views/${viewId}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
    },
    credentials: "include",
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    throw new Error(`Failed to update view: ${response.statusText}`);
  }

  return response.json();
}

/**
 * Delete a view
 */
export async function deleteMoleculeView(viewId: number, userId: number): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/api/molecule-views/${viewId}?userId=${userId}`, {
    method: "DELETE",
    credentials: "include",
  });

  if (!response.ok) {
    throw new Error(`Failed to delete view: ${response.statusText}`);
  }
}

/**
 * Mark a view as last viewed
 */
export async function markViewAsViewed(viewId: number, userId: number): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/api/molecule-views/${viewId}/view`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    credentials: "include",
    body: JSON.stringify({ userId }),
  });

  if (!response.ok) {
    throw new Error(`Failed to mark view as viewed: ${response.statusText}`);
  }
}

/**
 * Update a pin status for a reference in a view
 */
export async function updatePin(viewId: number, data: UpdatePinRequest, userId: number): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/api/molecule-views/${viewId}/pins`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    credentials: "include",
    body: JSON.stringify({ ...data, userId }),
  });

  if (!response.ok) {
    throw new Error(`Failed to update pin: ${response.statusText}`);
  }
}

/**
 * Update multiple pins at once
 */
export async function updatePinsBulk(
  viewId: number,
  pins: UpdatePinRequest[],
  userId: number
): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/api/molecule-views/${viewId}/pins/bulk`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    credentials: "include",
    body: JSON.stringify({ pins, userId }),
  });

  if (!response.ok) {
    throw new Error(`Failed to update pins: ${response.statusText}`);
  }
}

/**
 * Update node positions for a view
 */
export async function updateViewPositions(
  viewId: number,
  positions: Record<string, { x: number; y: number }>,
  userId: number
): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/api/molecule-views/${viewId}/positions`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
    },
    credentials: "include",
    body: JSON.stringify({ positions, userId }),
  });

  if (!response.ok) {
    throw new Error(`Failed to update positions: ${response.statusText}`);
  }
}
