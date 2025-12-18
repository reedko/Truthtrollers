// backend/src/storage/persistPublishers.js

import logger from "../utils/logger.js";

export async function persistPublishers(query, contentId, publisher = null) {
  logger.log(contentId, publisher, ":pufsdfadf");
  if (!contentId || !publisher || !publisher.publisher_name) return null;

  const {
    publisher_name,
    publisher_owner = null,
    publisher_icon = null,
  } = publisher;

  // CALL InsertOrGetPublisher(...)
  const rows = await query(
    `
      CALL InsertOrGetPublisher(?, ?, ?, @publisherId);
     
    `,
    [publisher_name, publisher_owner, publisher_icon]
  );
  logger.log(rows, ":PUBLISHERS");
  const publisherId = rows[0][0].publisherId;

  // Link content ↔ publisher
  await query(
    `
      INSERT IGNORE INTO content_publishers (content_id, publisher_id)
      VALUES (?, ?)
    `,
    [contentId, publisherId]
  );

  return publisherId;
}
