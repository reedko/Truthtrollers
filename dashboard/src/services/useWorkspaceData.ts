import axios from "axios";
import { Claim } from "../../../shared/entities/types";

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || "http://localhost:5001";

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

/**
 * Add a new claim
 */
export const createClaim = async (claimText: string, contentId: number) => {
  try {
    const response = await axios.post(`${API_BASE_URL}/api/claims`, {
      contentId,
      claimText,
    });
    return response.data; // Returns the created claim
  } catch (error) {
    console.error("❌ Error creating claim:", error);
    return null;
  }
};

/**
 * Update an existing claim
 */
export const updateClaim = async (claimText: string, claimId: number) => {
  try {
    await axios.put(`${API_BASE_URL}/api/claims/${claimId}`, { claimText });
  } catch (error) {
    console.error("❌ Error updating claim:", error);
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

/**
 * Fetch all references for a given content ID
 */
export const fetchReferencesForTask = async (contentId: number) => {
  try {
    const response = await axios.get(
      `${API_BASE_URL}/api/content/${contentId}/source-references`
    );
    console.log("📄 References Data:", response.data); // Debugging
    return response.data; // ✅ Returns all references for the task
  } catch (error) {
    console.error("❌ Error fetching references:", error);
    return [];
  }
};

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
 * Associate a selected reference with a task
 */
export const addReferenceToTask = async (
  taskContentId: number,
  referenceContentId: number
) => {
  try {
    await axios.post(`${API_BASE_URL}/api/add-content-relation`, {
      taskContentId, // ✅ Fixed key name
      referenceContentId, // ✅ Fixed key name
    });
  } catch (error) {
    console.error("❌ Error adding reference to task:", error);
  }
};

/**
 * Update an existing reference
 */
export const updateReference = async (
  referenceId: number,
  referenceName: string,
  url: string
) => {
  try {
    await axios.put(`${API_BASE_URL}/api/references/${referenceId}`, {
      referenceName,
      url,
    });
  } catch (error) {
    console.error("❌ Error updating reference:", error);
  }
};

/**
 * Delete a reference
 */
export const deleteReference = async (referenceId: number) => {
  try {
    await axios.delete(`${API_BASE_URL}/api/references/${referenceId}`);
  } catch (error) {
    console.error("❌ Error deleting reference:", error);
  }
};
/**
 * Search for existing content references by title or URL
 */
export const searchExistingContent = async (query: string) => {
  try {
    const response = await axios.get(
      `${API_BASE_URL}/api/search-content?query=${encodeURIComponent(query)}`
    );
    return response.data; // List of matching content items
  } catch (error) {
    console.error("❌ Error searching for content:", error);
    return [];
  }
};

/**
 * Scrape new content from a given URL
 */
export const scrapeNewContent = async (url: string) => {
  try {
    const response = await axios.post(`${API_BASE_URL}/api/scrape-content`, {
      url,
    });
    return response.data; // Newly scraped content
  } catch (error) {
    console.error("❌ Error scraping content:", error);
    return null;
  }
};

/**
 * Scrape a new reference by URL and add it to the database.
 */
export const scrapeAndAddReference = async (taskId: number, url: string) => {
  try {
    const response = await axios.post(`${API_BASE_URL}/api/scrape`, {
      url,
      taskId,
    });
    return response.data; // Returns the new reference object
  } catch (error) {
    console.error("❌ Error scraping reference:", error);
    return null;
  }
};
