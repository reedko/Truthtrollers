import axios from "axios";
import {
  Task,
  User,
  Author,
  Publisher,
  LitReference,
  Claim,
  ReferenceWithClaims,
} from "../../../shared/entities/types";

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || "http://localhost:5001";

/** --------------------- 📝 TASK (CONTENT) FUNCTIONS --------------------- **/
/** fetch one task  */
// services/useDashboardAPI.ts

export async function fetchTaskById(taskId: number): Promise<Task> {
  const response = await fetch(`${API_BASE_URL}/api/tasks/${taskId}`);
  if (!response.ok) throw new Error("Failed to fetch task");
  return response.json();
}
/**
 * Fetch all tasks (content items).
 */
export const fetchTasks = async (page = 1, limit = 25): Promise<Task[]> => {
  try {
    const response = await axios.get(`${API_BASE_URL}/api/content`, {
      params: { page, limit },
    });
    return response.data;
  } catch (error) {
    console.error("❌ Error fetching paginated tasks:", error);
    return [];
  }
};

/**
 * Fetch all assigned users for a given task.
 */
export const fetchAssignedUsers = async (taskId: number): Promise<User[]> => {
  try {
    const response = await axios.get(
      `${API_BASE_URL}/api/content/${taskId}/get-users`
    );
    return response.data;
  } catch (error) {
    console.error("❌ Error fetching assigned users:", error);
    return [];
  }
};

/** --------------------- 🔎 CLAIMS FUNCTIONS --------------------- **/

/**
 * Fetch all claims for a specific task (contentId)
 */
export const fetchClaimsForTask = async (
  contentId: number
): Promise<Claim[]> => {
  try {
    const response = await axios.get(`${API_BASE_URL}/api/claims/${contentId}`);
    return response.data;
  } catch (error) {
    console.error("❌ Error fetching claims:", error);
    return [];
  }
};

// ✅ Add a new claim (with full metadata)
export const addClaim = async (claimData: {
  claim_text: string;
  veracity_score?: number;
  confidence_level?: number;
  last_verified?: string;
  content_id: number;
  relationship_type?: string;
}) => {
  try {
    const response = await axios.post(`${API_BASE_URL}/api/claims`, claimData);
    console.log("✅ Claim added:", response.data);
    return response.data;
  } catch (error) {
    console.error("❌ Error adding claim:", error);
    throw error;
  }
};

// ✅ Update an existing claim
export const updateClaim = async (claim: Claim): Promise<Claim> => {
  try {
    const response = await axios.put(
      `${API_BASE_URL}/api/claims/${claim.claim_id}`,
      claim
    );
    console.log("✅ Claim updated:", response.data);
    return { ...claim }; // or response.data if it returns the whole claim
  } catch (error) {
    console.error("❌ Error updating claim:", error);
    throw error;
  }
};

/**
 * Update an existing reference
 */
export const updateReference = async (
  reference_content_id: number,
  title: string
) => {
  try {
    console.log("🧪 Sending PUT to updateReference:", {
      title,
      content_id: reference_content_id,
    });
    await axios.put(`${API_BASE_URL}/api/updateReference`, {
      content_id: reference_content_id,
      title, // Send title in the request body
    });
    console.log(`✅ Reference ${reference_content_id} updated to "${title}".`);
  } catch (error) {
    console.error("❌ Error updating reference:", error);
  }
};
/**
 * Delete a claim
 */
export const deleteClaim = async (claimId: number) => {
  try {
    await axios.delete(`${API_BASE_URL}/api/claims/${claimId}`);
  } catch (error) {
    console.error("❌ Error deleting claim:", error);
  }
};

/** --------------------- 📚 REFERENCES FUNCTIONS --------------------- **/
/**
 * Fetch all references from the database.
 */
export const fetchAllReferences = async (searchTerm: string, page: number) => {
  try {
    const searchQuery =
      searchTerm && searchTerm !== "all"
        ? encodeURIComponent(searchTerm)
        : "all";
    const response = await axios.get(
      `${API_BASE_URL}/api/references/${searchQuery}?page=${page}`
    );

    console.log("✅ API Response (Page", page, "):", response.data);
    return response.data; // ✅ Returns paginated data
  } catch (error) {
    console.error("❌ Error fetching references:", error);
    return [];
  }
};
/**
 * Fetch all references for a given task (contentId)
 */
export const fetchReferencesForTask = async (contentId: number) => {
  try {
    const response = await axios.get(
      `${API_BASE_URL}/api/content/${contentId}/source-references`
    );
    return response.data;
  } catch (error) {
    console.error("❌ Error fetching references:", error);
    return [];
  }
};

export const fetchReferencesWithClaimsForTask = async (
  taskContentId: number
): Promise<ReferenceWithClaims[]> => {
  const response = await fetch(
    `${API_BASE_URL}/api/content/${taskContentId}/references-with-claims`
  );

  if (!response.ok) {
    throw new Error("Failed to fetch references with claims");
  }

  return response.json();
};

//Add a link between two claims
export const addClaimLink = async ({
  source_claim_id,
  target_claim_id,
  user_id,
  relationship,
  support_level,
}: {
  source_claim_id: number;
  target_claim_id: number;
  user_id: number;
  relationship: "supports" | "refutes" | "related";
  support_level: number;
}) => {
  try {
    const response = await axios.post(`${API_BASE_URL}/api/claim-links`, {
      source_claim_id,
      target_claim_id,
      user_id,
      relationship,
      support_level,
    });
    return response.data;
  } catch (error) {
    console.error("❌ Error adding claim link:", error);
    throw error;
  }
};

/**
 * Remove a reference from a task
 */
export const deleteReferenceFromTask = async (
  taskContentId: number,
  referenceContentId: number
) => {
  try {
    await axios.delete(`${API_BASE_URL}/api/remove-content-relation`, {
      data: { taskContentId, referenceContentId },
    });
    console.log(
      `✅ Reference ${referenceContentId} removed from Task ${taskContentId}`
    );
  } catch (error) {
    console.error("❌ Error removing reference from task:", error);
  }
};

/**
 * Fetch all references linked to a specific claim
 */
export const fetchClaimReferences = async (claimId: number) => {
  try {
    const response = await axios.get(
      `${API_BASE_URL}/api/claims/${claimId}/references`
    );
    return response.data;
  } catch (error) {
    console.error("❌ Error fetching claim references:", error);
    return [];
  }
};

/**
 * Fetch all authors associated with a task.
 */
export const fetchAuthors = async (taskId: number): Promise<Author[]> => {
  try {
    const response = await axios.get(
      `${API_BASE_URL}/api/content/${taskId}/authors`
    );
    return response.data;
  } catch (error) {
    console.error("❌ Error fetching authors:", error);
    return [];
  }
};

/**
 * Fetch all publishers associated with a task.
 */
export const fetchPublishers = async (taskId: number): Promise<Publisher[]> => {
  try {
    const response = await axios.get(
      `${API_BASE_URL}/api/content/${taskId}/publishers`
    );
    return response.data;
  } catch (error) {
    console.error("❌ Error fetching publishers:", error);
    return [];
  }
};

/**
 * Fetch all users in the system.
 */
export const fetchUsers = async (): Promise<User[]> => {
  try {
    const response = await axios.get(`${API_BASE_URL}/api/all-users`);
    return response.data;
  } catch (error) {
    console.error("❌ Error fetching users:", error);
    return [];
  }
};

/**
 * Associate a selected reference with a task
 */
export const addReferenceToTask = async (
  taskContentId: number,
  referenceContentId: number
) => {
  try {
    await axios.post(`${API_BASE_URL}/api/add-content-relation`, {
      taskContentId,
      referenceContentId,
    });
  } catch (error) {
    console.error("❌ Error adding reference to task:", error);
  }
};

/**
 * Add a reference to a claim
 */
export const addReferenceToClaim = async (
  claimId: number,
  referenceId: number,
  userId: number,
  supportLevel: number
) => {
  try {
    await axios.post(`${API_BASE_URL}/api/claims/add-claim-reference`, {
      claimId,
      referenceId,
      userId,
      supportLevel,
    });
  } catch (error) {
    console.error("❌ Error adding reference to claim:", error);
  }
};

/** --------------------- 🔍 SEARCH FUNCTIONS --------------------- **/

/**
 * Search for existing content references by title or URL
 */
export const searchExistingContent = async (query: string) => {
  try {
    const response = await axios.get(
      `${API_BASE_URL}/api/search-content?query=${encodeURIComponent(query)}`
    );
    return response.data;
  } catch (error) {
    console.error("❌ Error searching for content:", error);
    return [];
  }
};

/** --------------------- 🌐 SCRAPING FUNCTIONS --------------------- **/

/**
 * Scrape new content from a given URL
 */
export const scrapeNewContent = async (url: string) => {
  try {
    const response = await axios.post(`${API_BASE_URL}/api/scrape-content`, {
      url,
    });
    return response.data;
  } catch (error) {
    console.error("❌ Error scraping content:", error);
    return null;
  }
};

/**
 * Scrape a new reference by URL and add it to the database.
 */
export const scrapeAndAddReference = async (url: string, taskId: number) => {
  try {
    const response = await axios.post(`${API_BASE_URL}/api/scrape-reference`, {
      url,
      taskId,
    });

    if (response.status === 200) {
      console.log("✅ Scraped reference added:", response.data);
      return response.data;
    }
  } catch (error) {
    console.error("❌ Error scraping reference:", error);
  }
  return null;
};
