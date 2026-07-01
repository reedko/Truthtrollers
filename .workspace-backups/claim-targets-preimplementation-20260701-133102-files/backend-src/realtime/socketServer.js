// backend/src/realtime/socketServer.js
import { Server } from "socket.io";
import jwt from "jsonwebtoken";
import webpush from "web-push";

// Track which users are currently connected: userId -> Set<socketId>
const onlineUsers = new Map();

/** Returns true if the user has at least one active socket connection */
export function isOnline(userId) {
  return onlineUsers.has(userId) && onlineUsers.get(userId).size > 0;
}

/** Returns a Set of all currently online user IDs */
export function getOnlineUserIds() {
  return new Set(onlineUsers.keys());
}

export function initSocketServer(httpServer, pool) {
  // Set VAPID details here (after dotenv has loaded in server.js)
  webpush.setVapidDetails(
    process.env.VAPID_EMAIL,
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );

  const io = new Server(httpServer, {
    cors: {
      origin: [
        "http://localhost:5173",
        "https://localhost:5173",
        "https://truthtrollers.com",
        "http://truthtrollers.com",
      ],
      credentials: true,
    },
  });

  // ── Auth middleware ──────────────────────────────────────────
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error("No token"));
    try {
      const payload = jwt.verify(token, process.env.JWT_SECRET);
      socket.user = payload; // { user_id, username, can_post }
      next();
    } catch {
      next(new Error("Invalid token"));
    }
  });

  // ── Connection ───────────────────────────────────────────────
  io.on("connection", (socket) => {
    const { user_id, username } = socket.user;

    // Track online status
    if (!onlineUsers.has(user_id)) onlineUsers.set(user_id, new Set());
    onlineUsers.get(user_id).add(socket.id);

    // Each user has a personal room for targeted delivery
    socket.join(`user:${user_id}`);
    console.log(`[socket] ${username} (${user_id}) connected`);

    // Broadcast presence to everyone
    io.emit("presence", { user_id, online: true });

    // ── send_message event ────────────────────────────────────
    socket.on("send_message", async ({ recipientId, body }) => {
      if (!recipientId || !body?.trim()) return;

      try {
        // Persist to DB
        const result = await queryPool(pool,
          "INSERT INTO chat_messages (sender_id, recipient_id, body) VALUES (?, ?, ?)",
          [user_id, recipientId, body.trim()]
        );

        const message = {
          id: result.insertId,
          sender_id: user_id,
          sender_username: username,
          recipient_id: recipientId,
          body: body.trim(),
          created_at: new Date().toISOString(),
          read_at: null,
        };

        // Emit to recipient's personal room (all their browser tabs)
        io.to(`user:${recipientId}`).emit("new_message", message);
        // Also emit back to sender (confirms delivery + syncs other tabs)
        io.to(`user:${user_id}`).emit("new_message", message);

        // If recipient has NO active sockets → send push notification
        if (!onlineUsers.has(recipientId) || onlineUsers.get(recipientId).size === 0) {
          await sendPushToUser(pool, recipientId, {
            title: `New message from ${username}`,
            body: body.trim().substring(0, 100),
            url: "/chat",
          });
        }
      } catch (err) {
        console.error("[socket] send_message error:", err.message);
        socket.emit("message_error", { error: "Failed to send message" });
      }
    });

    // ── mark_read event ───────────────────────────────────────
    socket.on("mark_read", async ({ senderId }) => {
      try {
        await queryPool(pool,
          "UPDATE chat_messages SET read_at = NOW() WHERE sender_id = ? AND recipient_id = ? AND read_at IS NULL",
          [senderId, user_id]
        );
        // Tell the sender their messages were read
        io.to(`user:${senderId}`).emit("messages_read", { by: user_id });
      } catch (err) {
        console.error("[socket] mark_read error:", err.message);
      }
    });

    // ── disconnect ────────────────────────────────────────────
    socket.on("disconnect", () => {
      const sockets = onlineUsers.get(user_id);
      if (sockets) {
        sockets.delete(socket.id);
        if (sockets.size === 0) {
          onlineUsers.delete(user_id);
          // Broadcast offline presence only when last tab disconnects
          io.emit("presence", { user_id, online: false });
        }
      }
      console.log(`[socket] ${username} (${user_id}) disconnected`);
    });
  });

  return io;
}

// ── Helpers ────────────────────────────────────────────────────

function queryPool(pool, sql, params) {
  return new Promise((resolve, reject) => {
    pool.query(sql, params, (err, results) => {
      if (err) reject(err);
      else resolve(results);
    });
  });
}

async function sendPushToUser(pool, userId, payload) {
  try {
    const subs = await queryPool(pool,
      "SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?",
      [userId]
    );
    for (const sub of subs) {
      const pushSub = {
        endpoint: sub.endpoint,
        keys: { p256dh: sub.p256dh, auth: sub.auth },
      };
      webpush.sendNotification(pushSub, JSON.stringify(payload)).catch((err) => {
        if (err.statusCode === 410) {
          // Subscription expired — clean it up
          queryPool(pool,
            "DELETE FROM push_subscriptions WHERE endpoint = ?",
            [sub.endpoint]
          ).catch(() => {});
        }
      });
    }
  } catch (err) {
    console.error("[push] sendPushToUser error:", err.message);
  }
}
