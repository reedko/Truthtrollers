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
  ClaimLinks,
  DiscussionEntry,
  LinkedClaim,
} from "../../../shared/entities/types";

const API_BASE_URL = import.meta.env.VITE_BASE_URL || "https://localhost:5001";

//contentscores
export const fetchContentScores = async (
  contentId: number,
  userId: number | null
) => {
  const res = await fetch(`${API_BASE_URL}/api/content/${contentId}/scores`);
  if (!res.ok) throw new Error("Failed to fetch content scores");
  const data = await res.json();
  return {
    verimeterScore: Number(data.verimeter_score) || 0,
    trollmeterScore: Number(data.trollmeter_score) || 0,
    pro: Number(data.pro_score) || 0,
    con: Number(data.con_score) || 0,
    contentId: Number(contentId),
  };
};

export type ClaimVerdict = "true" | "false" | "uncertain";

export async function saveClaimVerification(input: {
  claim_id: number;
  user_id?: number | null;
  verdict: ClaimVerdict;
  confidence: number; // 0..1
  notes?: string;
}) {
  const res = await fetch(`${API_BASE_URL}/api/claim-verifications`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      claim_id: input.claim_id,
      user_id: input.user_id ?? null,
      verdict: input.verdict,
      confidence: input.confidence,
      notes: input.notes ?? "",
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Failed to save claim verification: ${res.status} ${text}`);
  }
  return res.json();
}

export async function updateScoresForContent(
  contentId: number,
  userId: number | null
): Promise<void> {
  await fetch(`${API_BASE_URL}/api/content/${contentId}/scores/recompute`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId }), // 👈 pass userId to backend
  });
}
//task claims to reference links

//UPLOAD IMAGES
export const uploadImage = async (
  id: number,
  file: File,
  type: "authors" | "publishers"
): Promise<string | null> => {
  const formData = new FormData();
  formData.append("image", file); // ✅ only append the file here

  const response = await fetch(
    `${API_BASE_URL}/api/upload-image?type=${type}&id=${id}`,
    {
      method: "POST",
      body: formData,
    }
  );

  if (!response.ok) {
    console.error("Image upload failed");
    return null;
  }

  const data = await response.json();
  return data.path;
};

/**
 * Fetch Verimeter Score for a given task (by content_id)
 */
export const fetchVerimeterScore = async (taskContentId: number) => {
  const res = await fetch(`${API_BASE_URL}/api/verimeter/${taskContentId}`);
  if (!res.ok) throw new Error("Failed to fetch Verimeter score");
  return await res.json();
};
export const fetchClaimScores = async (
  contentId: number,
  viewerId: number | null
): Promise<{ [claimId: number]: number }> => {
  try {
    const res = await axios.get(
      `${API_BASE_URL}/api/content/${contentId}/claim-scores`,
      {
        params: { viewerId },
      }
    );
    return res.data;
  } catch (err) {
    console.error("Error in fetchClaimScores:", err);
    return {};
  }
};
/**
 * Fetch Trollmeter Score (crowd sentiment) for a given task (by content_id)
 */
export const fetchTrollmeterScore = async (taskContentId: number) => {
  const res = await fetch(`${API_BASE_URL}/api/trollmeter/${taskContentId}`);
  if (!res.ok) throw new Error("Failed to fetch Trollmeter score");
  return await res.json();
};

// 🔵 AUTHOR BIO
export const updateAuthorBio = async (authorId: number, newBio: string) => {
  const res = await axios.put(`${API_BASE_URL}/api/authors/${authorId}/bio`, {
    description: newBio,
  });
  return res.data;
};
// 🔵 PUBLISHER BIO
export const updatePublisherBio = async (
  publisherId: number,
  newBio: string
) => {
  const res = await axios.put(
    `${API_BASE_URL}/api/publishers/${publisherId}/bio`,
    {
      description: newBio,
    }
  );
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

//update all author ratings
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

//update single author rating
export const updateAuthorRating = async (
  authorRatingId: number,
  ratings: AuthorRating
) => {
  let res;
  if (authorRatingId !== 0) {
    res = await axios.put(
      `${API_BASE_URL}/api/authors/${authorRatingId}/rating`,
      { ratings }
    );
  } else {
    //add a new rating
    res = await axios.post(`${API_BASE_URL}/api/authors/add-rating`, {
      ratings,
    });
  }
  return res.data;
};

// 🔵 PUBLISHER RATINGS
export const fetchPublisherRatings = async (publisherId: number) => {
  try {
    const res = await axios.get(
      `${API_BASE_URL}/api/publishers/${publisherId}/ratings`
    );

    return res.data;
  } catch (err) {
    console.error("❌ Failed to fetch publisher ratings:", err);
    return [];
  }
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

//update a single publisher rating
export const updatePublisherRating = async (
  publisherRatingId: number,
  rating: PublisherRating
) => {
  const res = await axios.put(
    `${API_BASE_URL}/api/publishers/${publisherRatingId}/rating`,
    {
      rating,
    }
  );
  return res.data;
};
/** --------------------- 📝 TASK (CONTENT) FUNCTIONS --------------------- **/
/** fetch one task  */
/** fetch one task  */
// services/useDashboardAPI.ts

export async function fetchTaskById(taskId: number): Promise<Task> {
  const response = await fetch(`${API_BASE_URL}/api/tasks/${taskId}`);
  if (!response.ok) throw new Error("Failed to fetch task");
  return response.json();
}
// services/useDashboardAPI.ts

// ✅ useDashboardAPI.ts

//Fetch all taskinfo by publisher, author or task id
export async function fetchUnifiedTasksByPivot(
  pivotType: "task" | "author" | "publisher" | "reference",
  pivotId: number
): Promise<Task[]> {
  const response = await fetch(
    `${API_BASE_URL}/api/unified-tasks/${pivotType}/${pivotId}`
  );

  if (!response.ok) throw new Error("Failed to fetch unified tasks");
  return response.json();
}
export interface RatedClaim {
  claim_id: number;
  claim_text: string;
  verimeter_score: number; // Expected truth score (-1 to 1)
}

export async function fetchTaskClaimsWithRatings(
  taskId: number,
  viewerId: number
): Promise<RatedClaim[]> {
  const res = await fetch(
    `${API_BASE_URL}/api/task/${taskId}/claims?viewerId=${viewerId}`
  );
  if (!res.ok) throw new Error("Failed to fetch claims");
  return res.json();
}

/**
 * Fetch all tasks (content items).
 */
export const fetchTasks = async (page = 1, limit = 100): Promise<Task[]> => {
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

/**
 * fetch all tasks for a user
 *
 */

export const fetchTasksForUser = async (userId: number): Promise<Task[]> => {
  const res = await axios.get(`${API_BASE_URL}/api/user-tasks/${userId}`);
  return res.data;
};

/** --------------------- 🔎 CLAIMS FUNCTIONS --------------------- **/
//fetch claims linked to a certain task claim
export interface LinkedClaim1 {
  claim_link_id: number;
  target_claim_id: number;
  source_claim_id: number;
  relationship: string;
  support_level: number;
  veracity: number | null;
  bias: number | null;
  notes: string | null;
  claim_text: string;
  reference_content_id: number;
}

export const fetchLinkedClaimsForTask = async (
  contentId: number,
  viewerId?: number | null
): Promise<LinkedClaim[]> => {
  const url = new URL(
    `${API_BASE_URL}/api/linked-claims-for-task/${contentId}`
  );
  if (viewerId) url.searchParams.append("viewerId", viewerId.toString());

  const res = await fetch(url.toString());
  if (!res.ok) {
    throw new Error("Failed to fetch linked claims");
  }

  return await res.json();
};

export const fetchLiveVerimeterScore = async (
  claimId: number,
  viewerId: number | null
): Promise<{
  verimeter_score: number;
  num_links: number;
  num_references: number;
  avg_reference_veracity: number;
  avg_reference_bias: number;
}> => {
  const qs =
    viewerId != null ? `?viewerId=${encodeURIComponent(viewerId)}` : "";
  const res = await fetch(
    `${API_BASE_URL}/api/live-verimeter-score/${claimId}${qs}`
  );
  if (!res.ok) throw new Error("Failed to fetch live verimeter score");
  return await res.json();
};
export const fetchLinkedClaimsForTaskClaim = async (
  claimId: number,
  viewerId?: number | null
): Promise<LinkedClaim[]> => {
  const qs = viewerId ? `?viewerId=${encodeURIComponent(viewerId)}` : "";
  const res = await fetch(
    `${API_BASE_URL}/api/linked-claims-for-claim/${claimId}${qs}`
  );

  if (!res.ok) {
    throw new Error("Failed to fetch linked claims");
  }

  return res.json();
};
//fetch a claim by claim id
//
export async function fetchClaimById(claimId: number): Promise<Claim> {
  const response = await axios.get(`${API_BASE_URL}/api/claim/${claimId}`);
  return response.data[0];
}
/**
 * Fetch all claims for a specific task (contentId)
 */
export const fetchClaimsAndLinkedReferencesForTask = async (
  contentId: number,
  viewerId: number | null
): Promise<ClaimLinks[]> => {
  try {
    const response = await axios.get(
      `${API_BASE_URL}/api/claims-and-linked-references/${contentId}`,
      { params: { viewerId } }
    );

    return response.data;
  } catch (error) {
    console.error("❌ Error fetching linked refs:", error);
    throw error;
  }
};
// fetchclaimsources for quiz

/**
 * Fetch all claims for a specific task (contentId)
 */
export const fetchClaimsForTask = async (
  contentId: number,
  viewerId: number | null
): Promise<Claim[]> => {
  try {
    const response = await axios.get(
      `${API_BASE_URL}/api/claims/${contentId}`,
      {
        params: { viewerId },
      }
    );

    return response.data;
  } catch (error) {
    console.error("❌ Error fetching claims:", error);
    return [];
  }
};

export const fetchClaimScoresForTask = async (
  contentId: number,
  viewerId: number | null
): Promise<{ [claimId: number]: number }> => {
  const res = await fetch(
    `${API_BASE_URL}/api/content/${contentId}/claim-scores?viewerId=${
      viewerId ?? ""
    }`
  );
  if (!res.ok) throw new Error("Failed to fetch claim scores");
  return await res.json();
};

//evaluate claims
export async function submitClaimEvaluation(data: {
  claim_id: number;
  reference_id: number;
  evaluation_text: string;
}) {
  return await axios.post(`${API_BASE_URL}/api/claim_verifications`, data);
}
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
  await axios.put(`${API_BASE_URL}/api/claim-sources/${claim_sources_id}`, {
    new_reference_id: newReferenceId,
    notes: notes,
  });
};

export const deleteClaimSource = async (
  claim_sources_id: number
): Promise<void> => {
  await axios.delete(`${API_BASE_URL}/api/claim-sources/${claim_sources_id}`);
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
  notes,
}: {
  source_claim_id: number;
  target_claim_id: number;
  user_id: number;
  relationship: "supports" | "refutes" | "related";
  support_level: number;
  notes: string;
}) => {
  try {
    const response = await axios.post(`${API_BASE_URL}/api/claim-links`, {
      source_claim_id,
      target_claim_id,
      user_id,
      relationship,
      support_level,
      notes,
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
 * Fetch a single author by author_id.
 */
export const fetchAuthor = async (authorId: number): Promise<Author | null> => {
  try {
    const response = await axios.get(
      `${API_BASE_URL}/api/content/${authorId}/author`
    );
    return response.data[0];
  } catch (error) {
    console.error("❌ Error fetching author:", error);
    return null;
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
 * Fetch a single publisher by publisher_id.
 */
export const fetchPublisher = async (
  publisherId: number
): Promise<Publisher | null> => {
  try {
    const response = await axios.get(
      `${API_BASE_URL}/api/content/${publisherId}/publisher`
    );
    return response.data[0];
  } catch (error) {
    console.error("❌ Error fetching author:", error);
    return null;
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

/**
 ** Discussions
 **/
export async function postDiscussionEntry(entry: Partial<DiscussionEntry>) {
  const res = await axios.post(`${API_BASE_URL}/api/discussion`, entry);
  return res.data;
}

export const fetchDiscussionEntries = async (
  contentId: number
): Promise<DiscussionEntry[]> => {
  const res = await axios.get(`${API_BASE_URL}/api/discussion/${contentId}`);
  if (Array.isArray(res.data)) return res.data;
  return [];
};

/**
 * Fetch AI evidence links (reference_claim_links) for a task
 * Returns links with support_level, stance, confidence, quote
 */
export const fetchAIEvidenceLinks = async (
  contentId: number
): Promise<import("../../../shared/entities/types").AIEvidenceLink[]> => {
  try {
    const res = await axios.get(
      `${API_BASE_URL}/api/reference-claim-links/${contentId}`
    );
    return res.data || [];
  } catch (error) {
    console.error("❌ Error fetching AI evidence links:", error);
    return [];
  }
};

/**
 * Fetch claims with their claim_type field
 * Used to distinguish snippets from regular claims
 */
export const fetchClaimsWithEvidence = async (
  contentId: number,
  viewerId?: number | null
): Promise<import("../../../shared/entities/types").Claim[]> => {
  try {
    const res = await axios.get(
      `${API_BASE_URL}/api/claims-with-evidence/${contentId}`,
      { params: { viewerId } }
    );
    return res.data || [];
  } catch (error) {
    console.error("❌ Error fetching claims with evidence:", error);
    return [];
  }
};

/**
 * Fetch failed references for a task
 * These are references that failed to scrape and need manual intervention
 */
export const fetchFailedReferences = async (
  taskContentId: number
): Promise<import("../../../shared/entities/types").FailedReference[]> => {
  try {
    const res = await axios.get(
      `${API_BASE_URL}/api/failed-references/${taskContentId}`
    );
    return res.data || [];
  } catch (error) {
    console.error("❌ Error fetching failed references:", error);
    return [];
  }
};
