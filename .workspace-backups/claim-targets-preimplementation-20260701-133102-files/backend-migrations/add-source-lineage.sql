-- Source lineage cache: tracks whether a URL is an original article, excerpt,
-- repost, pointer (link-roundup), syndicated copy, or archive.org wrapper.
-- Upstream chain is stored as JSON so we can walk back to the true original.

CREATE TABLE IF NOT EXISTS source_lineage_cache (
  id               INT AUTO_INCREMENT PRIMARY KEY,
  source_url       VARCHAR(2048)  NOT NULL,
  normalized_url   VARCHAR(2048)  NOT NULL,

  -- The primary classification of this URL's relationship to its content
  lineage_type     ENUM(
    'original',     -- first / authoritative source for this content
    'excerpt',      -- snippet / pull-quote from a larger piece
    'repost',       -- full republication of another article
    'syndicated',   -- proper syndication (rel=canonical matches upstream domain)
    'pointer',      -- link-roundup / via / h/t — mostly a reference to another URL
    'archive',      -- web.archive.org or similar archive wrapper
    'unknown'
  ) NOT NULL DEFAULT 'unknown',

  -- Immediate upstream URL (the URL this content came from / points to)
  upstream_url     VARCHAR(2048),
  -- Best-known publisher name at the upstream URL (may be null)
  upstream_publisher VARCHAR(512),

  -- How many hops from the root original we resolved (0 = this IS the original)
  chain_depth      TINYINT UNSIGNED NOT NULL DEFAULT 0,

  -- Full chain as JSON array: [ { url, lineageType, publisher, timestamp } , … ]
  -- Most-upstream entry first
  lineage_chain    JSON,

  -- Signals that drove this classification (debug/audit)
  detection_signals JSON,

  confidence       ENUM('high', 'medium', 'low') NOT NULL DEFAULT 'low',

  last_checked_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

  UNIQUE KEY uq_normalized_url (normalized_url(768)),
  KEY idx_lineage_type (lineage_type),
  KEY idx_upstream_url (upstream_url(512))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
