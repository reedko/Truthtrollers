// createTaskUtils.ts (Shared helpers)
import { Author, Publisher } from "../entities/Task";

export const BASE_URL =
  process.env.REACT_APP_BASE_URL || "https://localhost:5001";

export type GenericSuccessResponse = {
  success: boolean;
};

export type StoreClaimsResponse = {
  success: boolean;
  error?: string;
};

export const addAuthors = async (
  contentId: string,
  authors: Author[],
  isExtension: boolean,
  extensionSendMessage?: any
) => {
  if (isExtension && extensionSendMessage) {
    const response = (await extensionSendMessage({
      action: "addAuthors",
      contentId,
      authors,
    })) as GenericSuccessResponse;

    if (!response?.success) throw new Error("Failed to add authors");
  } else {
    await fetch(`${BASE_URL}/api/content/${contentId}/authors`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contentId, authors }),
    });
  }
};

export const addPublisher = async (
  contentId: string,
  publisher: Publisher,
  isExtension: boolean,
  extensionSendMessage?: any
) => {
  if (isExtension && extensionSendMessage) {
    const response = (await extensionSendMessage({
      action: "addPublisher",
      contentId,
      publisher,
    })) as GenericSuccessResponse;
    if (!response.success) throw new Error("Failed to add publisher");
  } else {
    await fetch(`${BASE_URL}/api/content/${contentId}/publishers`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contentId, publisher }),
    });
  }
};

export const storeClaimsInDB = async (
  contentId: string,
  claims: string[],
  contentType: string,
  userId: number | null,
  isExtension: boolean,
  extensionSendMessage?: any
) => {
  if (isExtension && extensionSendMessage) {
    const response = (await extensionSendMessage({
      action: "storeClaims",
      data: { contentId, claims, contentType, userId },
    })) as StoreClaimsResponse;
    if (!response.success) {
      throw new Error(response.error || "storeClaims failed");
    }
  } else {
    await fetch(`${BASE_URL}/api/claims/add`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content_id: contentId,
        claims,
        content_type: contentType,
        user_id: userId,
      }),
    });
  }
};
