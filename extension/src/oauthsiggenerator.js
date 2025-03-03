const oauthSignature = require("oauth-signature");
const request = require("request");
const crypto = require("crypto");

const KEY = "YOUR_KEY";
const SECRET = "YOUR_SECRET";

const url = "https://api.thenounproject.com/v2/icon";
const method = "GET";
const params = {
  query: "cat",
  limit_to_public_domain: "yes",
  thumbnail_size: "84",
  limit: "1",
  oauth_consumer_key: KEY,
  oauth_nonce: crypto.randomBytes(16).toString("hex"),
  oauth_signature_method: "HMAC-SHA1",
  oauth_timestamp: Math.floor(Date.now() / 1000),
  oauth_version: "1.0",
};

// Generate OAuth Signature
const signature = oauthSignature.generate(method, url, params, SECRET, null);

// Add signature to params
params.oauth_signature = signature;

// Convert params to OAuth header format
const authHeader = `OAuth ${Object.keys(params)
  .map((key) => `${key}="${params[key]}"`)
  .join(", ")}`;

// Perform API request with cURL
const curlCommand = `curl --request GET "${url}?query=cat&limit_to_public_domain=yes&thumbnail_size=84&limit=1" --header "Authorization: ${authHeader}"`;

console.log("Run this cURL command:\n", curlCommand);
