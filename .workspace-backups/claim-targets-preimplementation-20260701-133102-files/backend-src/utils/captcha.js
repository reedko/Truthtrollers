// /backend/src/utils/captcha.js

/**
 * Verify Google reCAPTCHA token
 * @param {string} token - reCAPTCHA response token
 * @returns {Promise<boolean>} - True if captcha is valid
 */
export async function verifyCaptcha(token) {
  const secret = process.env.VITE_RECAPTCHA_SECRET_KEY;
  const res = await fetch("https://www.google.com/recaptcha/api/siteverify", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `secret=${secret}&response=${token}`,
  });

  const data = await res.json();
  console.log("CAPTCHA VERIFICATION RESULT:", data);
  console.log("CAPTCHA VERIFICATION RESULT:", token);
  return data.success;
}
