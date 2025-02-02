interface DiffbotCategory {
  score: number; // Confidence score for the category
  name: string; // Name of the category (e.g., "Technology & Computing")
  id: string; // Unique ID for the category (e.g., "iabv2-596")
}

export interface DiffbotData {
  title?: string;
  publisher?: string;
  text?: string;
  author?: string;
  keywords?: string[];
  links?: string[];
  images?: { url: string }[]; // Array of image objects with URLs
  categories?: DiffbotCategory[]; // Array of categories
}
