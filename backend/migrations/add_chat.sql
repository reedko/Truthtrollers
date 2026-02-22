-- Chat messages between users
CREATE TABLE IF NOT EXISTS chat_messages (
  id INT PRIMARY KEY AUTO_INCREMENT,
  sender_id INT NOT NULL,
  recipient_id INT NOT NULL,
  body TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  read_at TIMESTAMP NULL,
  FOREIGN KEY (sender_id) REFERENCES users(user_id) ON DELETE CASCADE,
  FOREIGN KEY (recipient_id) REFERENCES users(user_id) ON DELETE CASCADE,
  INDEX idx_sender_recipient (sender_id, recipient_id),
  INDEX idx_recipient_unread (recipient_id, read_at)
);

-- Web Push subscriptions for phone/browser notifications
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id INT PRIMARY KEY AUTO_INCREMENT,
  user_id INT NOT NULL,
  endpoint TEXT NOT NULL,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY unique_sub (user_id, endpoint(200)),
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);
