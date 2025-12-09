// /backend/src/middleware/upload.js
import multer from "multer";
import path from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Multer storage configuration for image uploads
 * Images are stored in assets/images/{type}/ directory
 * Filename format: {type}_id_{id}.{ext}
 */
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const { type } = req.query;
    cb(null, path.join(__dirname, "../../assets/images", type));
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const { type, id } = req.query;
    if (!type || !id) return cb(new Error("Missing type or id"));
    cb(null, `${type.slice(0, -1)}_id_${id}${ext}`);
  },
});

export const upload = multer({ storage });
