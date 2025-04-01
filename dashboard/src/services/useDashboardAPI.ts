import axios from "axios";
import {
  Task,
  User,
  Author,
  Publisher,
  LitReference,
  Claim,
  ReferenceWithClaims,
  AuthorRating,
  PublisherRating,
} from "../../../shared/entities/types";

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || "http://localhost:5001";

//UPLOAD IMAGES
export const uploadImage = async (
  id: number,
  file: File,
  type: "authors" | "publishers"
): Promise<string | null> => {
  const formData = new FormData();
  formData.append("image", file);
  formData.append("id", id.toString());
  formData.append("type", type);

  const response = await fetch(`${API_BASE_URL}/api/upload-image`, {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    console.error("Image upload failed");
    return null;
  }

  const data = await response.json();
  return data.path;
};

// 🔵 AUTHOR BIO
export const updateAuthorBio = async (authorId: number, newBio: string) => {
  const res = await axios.put(`${API_BASE_URL}/api/authors/${authorId}/bio`, {
    description: newBio,
  });
  return res.data;
};

// 🔵 AUTHOR RATINGS
export const fetchAuthorRatings = async (
  authorId: number
): Promise<AuthorRating[]> => {
  const res = await axios.get(
    `${API_BASE_URL}/api/authors/${authorId}/ratings`
  );
  return res.data;
};

export const updateAuthorRatings = async (
  authorId: number,
  ratings: AuthorRating[]
) => {
  const res = await axios.put(
    `${API_BASE_URL}/api/authors/${authorId}/ratings`,
    { ratings }
  );
  return res.data;
};

// 🔵 PUBLISHER RATINGS
export const fetchPublisherRatings = async (publisherId: number) => {
  const res = await axios.get(
    `${API_BASE_URL}/api/publishers/${publisherId}/ratings`
  );
  return res.data;
};

//get ratings topics

export const fetchRatingTopics = async () => {
  const res = await axios.get(`${API_BASE_URL}/api/publishers/ratings-topics`);
  return res.data;
};

export const updatePublisherRatings = async (
  publisherId: number,
  ratings: PublisherRating[]
) => {
  const res = await axios.put(
    `${API_BASE_URL}/api/publishers/${publisherId}/ratings`,
    {
      ratings,
    }
  );
  return res.data;
};

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
 * Associate a selected reference with a claim
 */

export const addClaimSource = async (
  claimId: number,
  referenceContentId: number,
  isPrimary: boolean = false,
  userId?: number
): Promise<{ claim_source_id: number }> => {
  const response = await axios.post(`${API_BASE_URL}/api/claim-sources`, {
    claim_id: claimId,
    reference_content_id: referenceContentId,
    is_primary: isPrimary,
    user_id: userId,
  });
  return response.data;
};

export const fetchClaimSources = async (
  claimId: number
): Promise<
  {
    claim_source_id: number;
    reference_content_id: number;
    is_primary: boolean;
    created_at: string;
    content_name: string;
    url: string;
  }[]
> => {
  const response = await axios.get(
    `${API_BASE_URL}/api/claim-sources/${claimId}`
  );
  return response.data;
};

export const updateClaimSource = async (
  claim_sources_id: number,
  newReferenceId: number,
  notes: string
): Promise<void> => {
  await axios.put(`${API_BASE_URL}/claim-sources/${claim_sources_id}`, {
    new_reference_id: newReferenceId,
    notes: notes,
  });
};

export const deleteClaimSource = async (
  claim_sources_id: number
): Promise<void> => {
  await axios.delete(`${API_BASE_URL}/claim-sources/${claim_sources_id}`);
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
