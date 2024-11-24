export type NounProjectResponse = {
  icons: Array<{
    attribution: string;
    id: string;
    license_description: string;
    permalink: string;
    term: string;
    thumbnail_url: string;
    collections: Array<{
      id: string;
      name: string;
      creator: {
        name: string;
        permalink: string;
        username: string;
      };
    }>;
    tags: string[];
    creator: {
      name: string;
      permalink: string;
      username: string;
    };
  }>;
  generated_at: string;
  total: number;
  next_page?: string;
  usage_limits: {
    monthly: {
      limit: number;
      usage: number;
    };
  };
};
