export function getRelativePath(absolutePath) {
  // Assuming 'public/' is the part of the path that precedes the relative path
  const index = absolutePath.indexOf("public/");
  if (index !== -1) {
    // Return the path after 'public/'
    return absolutePath.slice(index + "public/".length);
  }
  // If 'public/' is not found, return the original path (or handle as needed)
  return absolutePath;
}

export const DEFAULT_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/113.0.0.0 Safari/537.36",
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Cache-Control": "no-cache",
  Pragma: "no-cache",
  Connection: "keep-alive",
  Referer: "https://www.google.com/",
};
