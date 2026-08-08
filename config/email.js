/**
 * @fileoverview email.js - Professional email helper for Safari Tours
 * Handles contact form emails, auto-replies, and emergency notifications
 */

const nodemailer = require('nodemailer');
const axios = require('axios');

// Load environment variables based on NODE_ENV
require('dotenv').config({
  path: process.env.NODE_ENV === 'production' ? '.env.production' : '.env.development'
});

// ==================== CONFIGURATION ====================

const config = {
  smtp: {
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT),
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
  emails: {
    admin: process.env.ADMIN_EMAIL,
    emergency: process.env.EMERGENCY_EMAIL || process.env.ADMIN_EMAIL,
  },
  company: {
    name: 'Launit Creatives Ltd',
    email: process.env.SMTP_USER,
    phone: '+254 746 039 119',
    address: 'Nairobi, Kenya',
    website: process.env.WEBSITE_URL || 'https://launit.com',
  }
};

// Validate configuration
if (!config.smtp.host || !config.smtp.port || !config.smtp.user || !config.smtp.pass) {
  throw new Error("❌ Missing SMTP environment variables (SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS)");
}

if (!config.emails.admin) {
  throw new Error("❌ ADMIN_EMAIL is not configured in environment variables");
}

// ==================== TRANSPORTER ====================

let transporter = null;
const hasSmtpCredentials = config.smtp.host && config.smtp.port && config.smtp.user && config.smtp.pass;

if (hasSmtpCredentials) {
  transporter = nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.port === 465, // true for 465, false for 587
    auth: {
      user: config.smtp.user,
      pass: config.smtp.pass,
    },
    tls: {
      rejectUnauthorized: process.env.NODE_ENV !== 'production',
      minVersion: 'TLSv1.2'
    }
  });

  // Verify transporter on startup
  transporter.verify((error, success) => {
    if (error) {
      console.error("🚨 SMTP connection failed:", error.message);
    } else {
      console.log("✅ SMTP Transporter verified successfully");
    }
  });
} else {
  console.warn("⚠️ SMTP credentials missing or partial. Outbound mailer will rely exclusively on Resend REST API fallback.");
}

// Verify transporter on startup
transporter.verify((error, success) => {
  if (error) {
    console.error("🚨 SMTP connection failed:", error.message);
  } else {
    console.log("✅ SMTP Transporter verified successfully");
  }
});

// ==================== EMAIL TEMPLATES ====================

/**
 * Base HTML template wrapper for consistent styling
 */
const emailWrapper = (content, headerColor = '#16a34a') => `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Safari Tours</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      background-color: #f3f4f6;
      padding: 20px;
      line-height: 1.6;
    }
    .email-container { max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1); }
    .email-header { background: linear-gradient(135deg, ${headerColor} 0%, ${adjustColor(headerColor, -20)} 100%); color: white; padding: 30px 20px; text-align: center; }
    .email-header h1 { font-size: 24px; font-weight: 700; margin-bottom: 5px; }
    .email-header p { font-size: 14px; opacity: 0.9; }
    .email-body { padding: 30px 25px; }
    .info-card { background-color: #f9fafb; border-left: 4px solid ${headerColor}; padding: 15px; margin: 15px 0; border-radius: 6px; }
    .info-row { display: flex; padding: 10px 0; border-bottom: 1px solid #e5e7eb; }
    .info-row:last-child { border-bottom: none; }
    .info-label { font-weight: 600; color: #374151; min-width: 100px; flex-shrink: 0; }
    .info-value { color: #6b7280; word-break: break-word; }
    .message-box { background-color: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; padding: 20px; margin: 20px 0; }
    .message-box h3 { color: #111827; font-size: 16px; margin-bottom: 10px; }
    .message-content { color: #4b5563; white-space: pre-wrap; line-height: 1.8; }
    .cta-button { display: inline-block; background: ${headerColor}; color: white; padding: 12px 30px; text-decoration: none; border-radius: 6px; font-weight: 600; margin: 20px 0; text-align: center; }
    .email-footer { background-color: #f9fafb; padding: 25px; text-align: center; border-top: 1px solid #e5e7eb; }
    .email-footer p { color: #6b7280; font-size: 13px; margin: 5px 0; }
    .social-links { margin-top: 15px; }
    .social-links a { color: ${headerColor}; text-decoration: none; margin: 0 10px; font-size: 12px; }
    .divider { height: 1px; background: linear-gradient(to right, transparent, #e5e7eb, transparent); margin: 20px 0; }
    @media only screen and (max-width: 600px) {
      .email-body { padding: 20px 15px; }
      .info-row { flex-direction: column; }
      .info-label { margin-bottom: 5px; }
    }
  </style>
</head>
<body>
  <div class="email-container">
    ${content}
  </div>
</body>
</html>
`;

/**
 * Helper to adjust color brightness
 */
function adjustColor(color, amount) {
  const clamp = (num) => Math.min(Math.max(num, 0), 255);
  const num = parseInt(color.replace('#', ''), 16);
  const r = clamp((num >> 16) + amount);
  const g = clamp(((num >> 8) & 0x00FF) + amount);
  const b = clamp((num & 0x0000FF) + amount);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

/**
 * Admin notification email template
 */
exports.contactAdminTemplate = (data) => {
  const content = `
    <div class="email-header">
      <h1>🦁 ${config.company.name}</h1>
      <p>New Contact Form Submission</p>
    </div>
    <div class="email-body">
      <p style="color: #111827; font-size: 16px; margin-bottom: 20px;">
        You've received a new message from your website contact form.
      </p>
      <div class="info-card">
        <div class="info-row"><span class="info-label">Name:</span><span class="info-value">${data.name}</span></div>
        <div class="info-row"><span class="info-label">Email:</span><span class="info-value"><a href="mailto:${data.email}" style="color: #16a34a;">${data.email}</a></span></div>
        ${data.phone ? `<div class="info-row"><span class="info-label">Phone:</span><span class="info-value"><a href="tel:${data.phone}" style="color: #16a34a;">${data.phone}</a></span></div>` : ''}
        <div class="info-row"><span class="info-label">Subject:</span><span class="info-value">${data.subject || 'No Subject'}</span></div>
      </div>
      <div class="message-box">
        <h3>📝 Message Content:</h3>
        <div class="message-content">${data.message.replace(/\n/g, '<br>')}</div>
      </div>
    </div>
  `;
  return emailWrapper(content, '#16a34a');
};

/**
 * Customer auto-reply email template
 */
exports.autoReplyTemplate = (data) => {
  const content = `
    <div class="email-header">
      <h1>🦁 ${config.company.name}</h1>
      <p>Thank You for Contacting Us</p>
    </div>
    <div class="email-body">
      <h2>Hello ${data.name}! 👋</h2>
      <p>We've received your message and our team will respond within 24 hours.</p>
    </div>
  `;
  return emailWrapper(content, '#16a34a');
};

/**
 * Emergency alert email template
 */
exports.emergencyAlertTemplate = (data) => {
  const content = `
    <div class="email-header" style="background: linear-gradient(135deg, #dc2626 0%, #991b1b 100%);">
      <h1>🚨 EMERGENCY ALERT</h1>
      <p>Urgent Contact Request - Immediate Action Required</p>
    </div>
    <div class="email-body">
      <div style="background: #fef2f2; border: 2px solid #dc2626; border-radius: 8px; padding: 15px; margin-bottom: 20px;">
        <p style="color: #dc2626; font-weight: 600; font-size: 14px; margin: 0;">
          ⚠️ This is an urgent emergency contact request. Please respond immediately.
        </p>
      </div>

      <div class="info-card" style="border-left-color: #dc2626;">
        <div class="info-row">
          <span class="info-label">Name:</span>
          <span class="info-value"><strong>${data.name}</strong></span>
        </div>
        <div class="info-row">
          <span class="info-label">Phone:</span>
          <span class="info-value"><a href="tel:${data.phone}" style="color: #dc2626; font-weight: 600;">${data.phone}</a></span>
        </div>
        ${data.email ? `
        <div class="info-row">
          <span class="info-label">Email:</span>
          <span class="info-value"><a href="mailto:${data.email}" style="color: #dc2626;">${data.email}</a></span>
        </div>
        ` : ''}
        ${data.location ? `
        <div class="info-row">
          <span class="info-label">Location:</span>
          <span class="info-value"><strong>${data.location}</strong></span>
        </div>
        ` : ''}
      </div>

      <div class="message-box" style="background: #fef2f2; border-color: #fecaca;">
        <h3 style="color: #dc2626;">🚨 Emergency Details:</h3>
        <div class="message-content" style="color: #991b1b;">${data.emergency.replace(/\n/g, '<br>')}</div>
      </div>

      <div style="text-align: center; margin: 30px 0;">
        <a href="tel:${data.phone}" class="cta-button" style="background: #dc2626;">
          📞 Call ${data.name} Immediately
        </a>
      </div>

      <div class="divider"></div>

      <p style="color: #6b7280; font-size: 13px; text-align: center;">
        📅 Emergency reported on ${new Date().toLocaleString('en-KE', { 
          dateStyle: 'full', 
          timeStyle: 'short',
          timeZone: 'Africa/Nairobi'
        })}
      </p>
    </div>
    <div class="email-footer">
      <p style="color: #dc2626; font-weight: 600;">URGENT - Please respond immediately</p>
      <p>${config.company.name} Emergency Response System</p>
    </div>
  `;
  return emailWrapper(content, '#dc2626');
};

// ==================== EMAIL SENDING FUNCTIONS ====================
/**
 * Dispatch generalized campaign or custom newsletter layouts
 */
exports.sendCampaignEmail = async (toEmail, subject, htmlContent) => {
  try {
    await transporter.sendMail({
      from: `"${config.company.name}" <${config.smtp.user}>`,
      to: toEmail,
      subject: subject,
      html: htmlContent,
    });
    return { success: true };
  } catch (error) {
    console.error(`❌ Campaign transmission failure to ${toEmail}:`, error.message);
    return { success: false, error: error.message };
  }
};

/**
 * Send contact form email (Admin notification + Customer auto-reply)
 */
exports.sendEmail = async (reqOrOptions, res) => {
  // 1. Determine the runtime environment execution pattern
  const isExpressRoute = reqOrOptions && reqOrOptions.body && typeof reqOrOptions.body === 'object';
  
  try {
    // --- MODE A: Programmatic Multi-Factor Authentication Call ---
    if (!isExpressRoute) {
      const options = reqOrOptions || {};
      
      // Fallback variables to prevent code crashes if properties aren't explicitly provided
      const targetEmail = options.to || options.email;
      const targetSubject = options.subject || "System Notification Secure Tracking Code";
      const targetHtml = options.html || options.message;

      if (!targetEmail || !targetHtml) {
        throw new Error("Programmatic email dispatch rejected: Target address ('to') or body payload ('html') is blank.");
      }

      // Execute direct, lightweight administrative dispatch immediately
      await transporter.sendMail({
        from: `"${config?.company?.name || 'LaUnit Creatives'}" <${config?.smtp?.user || process.env.EMAIL_USER}>`,
        to: targetEmail.trim().toLowerCase(),
        subject: targetSubject,
        html: targetHtml,
        text: options.text || "Please view this message in an HTML-compatible client.",
        headers: {
          'X-Priority': '1', // High priority for authorization challenge pins
          'X-Mailer': 'System Administrative Portal 2FA Hook',
          'X-Application': 'Backend Authorization Engine',
        }
      });

      console.log(`🔑 Programmatic 2FA/System notification dispatched successfully to: ${targetEmail}`);
      return true; // Return true to signal successful execution to calling async functions
    }

    // --- MODE B: Regular Contact Form Form Submission Routing ---
    const { name, email, phone, subject, message } = reqOrOptions.body;

    // Strict input presence verification
    if (!name || !email || !message) {
      return res.status(400).json({
        success: false,
        error: "Missing required fields: name, email, and message are mandatory.",
      });
    }

    // Email character format validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ 
        success: false, 
        error: "Invalid email formatting provided." 
      });
    }

    // Local sanitation to prevent cross-site scripting (XSS) within administrative dashboard panels
    const sanitizeHTML = (str) => {
      if (!str) return '';
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#x27;');
    };

    const formData = { 
      name: sanitizeHTML(name), 
      email: email.trim().toLowerCase(), 
      phone: sanitizeHTML(phone), 
      subject: sanitizeHTML(subject), 
      message: sanitizeHTML(message) 
    };

    // Dispatch notification to application administrator contact point
    await transporter.sendMail({
      from: `"${config.company.name}" <${config.smtp.user}>`,
      to: config.emails.admin,
      replyTo: `"${name}" <${email}>`,
      subject: `New Contact: ${name} - ${subject || 'General Inquiry'}`,
      html: typeof exports.contactAdminTemplate === 'function' ? exports.contactAdminTemplate(formData) : `<p>${formData.message}</p>`,
      text: `
New Contact Form Submission

Name: ${name}
Email: ${email}
${phone ? `Phone: ${phone}` : ''}
Subject: ${subject || 'No Subject'}

Message:
${message}

Received: ${new Date().toLocaleString('en-KE')}
      `.trim(),
      headers: {
        'X-Priority': '3',
        'X-Mailer': 'Safari Tours Contact Form',
        'X-Application': 'Safari Tours Website',
      }
    });

    console.log(`✅ Admin contact record notification sent to ${config.emails.admin}`);

    // Dispatch automated acknowledgement reply to prospective client
    await transporter.sendMail({
      from: `"${config.company.name}" <${config.smtp.user}>`,
      to: email,
      subject: `Thank you for contacting ${config.company.name}`,
      html: typeof exports.autoReplyTemplate === 'function' ? exports.autoReplyTemplate(formData) : `<h3>Message Received!</h3>`,
      text: `
Hello ${name},

Thank you for reaching out to ${config.company.name}. We've received your message and our team will respond within 24 hours.

Your message:
${message}

Contact Information:
Phone: ${config.company.phone}
Email: ${config.company.email}
Location: ${config.company.address}

Best regards,
${config.company.name} Team
      `.trim(),
      headers: {
        'X-Priority': '3',
        'X-Mailer': 'Safari Tours Auto-Reply',
        'X-Application': 'Safari Tours Website',
      }
    });

    console.log(`✅ Auto-reply notification tracking sent to customer: ${email}`);

    return res.status(200).json({
      success: true,
      message: "Message sent successfully! We'll respond within 24 hours.",
    });

  } catch (error) {
    console.error("❌ Error running email dispatch pipelines:", error);
    
    // If it's a programmatic direct function call, simply throw the exception up to the calling function
    if (!isExpressRoute) {
      throw error;
    }

    // Express client response fail-safes
    if (error.responseCode === 550 && error.response && error.response.includes('spam')) {
      return res.status(500).json({
        success: false,
        error: "Email was flagged as spam. Please try contacting us directly.",
        hint: `Phone: ${config?.company?.phone} | Email: ${config?.company?.email}`,
      });
    }
    
    return res.status(500).json({
      success: false,
      error: "Failed to process and send email message. Please try again later.",
      details: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

/**
 * Polymorphic Email Dispatch Service via REST API (Bypasses SMTP completely)
 * Location: config/email.js
 */
exports.sendAxiosEmail = async (reqOrOptions, res) => {
  const isExpressRoute = reqOrOptions && reqOrOptions.body && typeof reqOrOptions.body === 'object';
  
  let EMAIL_API_KEY = process.env.RESEND_API_KEY;
  if (EMAIL_API_KEY) EMAIL_API_KEY = EMAIL_API_KEY.trim();

  const personalInbox = 'kanimuy64@gmail.com';
  const resendSandboxSender = 'onboarding@resend.dev';

  try {
    let targetEmail, targetSubject, targetHtml, senderName, replyToEmail;

    if (!isExpressRoute) {
      const options = reqOrOptions || {};
      targetEmail = options.to || options.email;
      targetSubject = options.subject || "System Secure Verification Code";
      targetHtml = options.html || options.message;
      senderName = "LaUnit Security Control";
      replyToEmail = targetEmail;

      if (!targetEmail || !targetHtml) {
        throw new Error("Programmatic REST delivery rejected: Target parameters missing.");
      }
    } else {
      const { name, email, phone, subject, message } = reqOrOptions.body;
      if (!name || !email || !message) {
        return res.status(400).json({ success: false, error: "Missing required fields." });
      }
      targetEmail = config.emails.admin;
      replyToEmail = email.trim().toLowerCase();
      senderName = "Website Contact Form";
      targetSubject = `New Contact: ${name}`;
      targetHtml = `<p>${message}</p>`;
    }

    // --- AUTOMATED FALLBACK DEPLOYMENT (Terminal Output Loophole) ---
    if (!EMAIL_API_KEY || EMAIL_API_KEY === 'undefined' || EMAIL_API_KEY.length < 10) {
      console.warn(`\n⚠️ [WARN] RESEND_API_KEY not loaded. Intercepting verification payload locally:`);
      console.log(`📬 DEVELOPMENT SECURITY INTERCEPT:`);
      console.log(`👉 INTENDED DESTINATION INBOX: ${targetEmail}`);
      console.log(`👉 SECURITY 2FA MARKUP PAYLOAD:\n`, targetHtml, `\n`);
      
      if (isExpressRoute) {
        return res.status(200).json({ success: true, message: "Parsed to terminal." });
      }
      return true;
    }

    // --- DISPATCH OVER API ---
    let resolvedTo = targetEmail.trim().toLowerCase();

    if (process.env.NODE_ENV !== 'production') {
      // 🔑 CHANGE THIS TO false IF YOU WANT TO RISK DIRECT DISPATCHES ON VERIFIED SANDBOX ACCOUNTS
      const useResendSandboxForceRoute = false; 

      if (useResendSandboxForceRoute) {
        console.log(`ℹ️ Resend Sandbox Catch: Redirecting mail payload from [${targetEmail}] to owner dashboard [${personalInbox}] to bypass Resend unverified domain limits.`);
        resolvedTo = personalInbox;
      }
    }

    await axios.post('https://api.resend.com/emails', {
      from: `"${senderName}" <${resendSandboxSender}>`,
      to: [resolvedTo],
      reply_to: replyToEmail,
      subject: targetSubject,
      html: targetHtml
    }, {
      headers: {
        'Authorization': `Bearer ${EMAIL_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });

    console.log(`🚀 Email dispatched to: ${resolvedTo} (Intended recipient was: ${targetEmail})`);

    if (isExpressRoute) {
      return res.status(200).json({ success: true, message: "Dispatched successfully!" });
    }
    return true;

  } catch (error) {
    const errorDetails = error.response?.data?.message || error.message;
    console.error("❌ REST API Email Dispatch Exception:", errorDetails);
    if (!isExpressRoute) throw new Error(errorDetails);
    return res.status(500).json({ success: false, error: errorDetails });
  }
};

/**
 * Send emergency contact email
 */
exports.sendEmergencyContact = async (req, res) => {
  try {
    const { name, phone, email, location, emergency } = req.body;

    // Validation
    if (!name || !phone || !emergency) {
      return res.status(400).json({
        success: false,
        error: "Missing required fields: name, phone, and emergency details are mandatory.",
      });
    }

    const emergencyData = { name, phone, email, location, emergency };

    // Send emergency alert
    await transporter.sendMail({
      from: `"🚨 ${config.company.name} Emergency" <${config.smtp.user}>`,
      to: config.emails.emergency,
      subject: `🚨 URGENT: Emergency Contact from ${name}`,
      html: exports.emergencyAlertTemplate(emergencyData),
      headers: {
        'X-Priority': '1', // 1 = High/Urgent, 3 = Normal, 5 = Low
        'Importance': 'high'
      }
    });

    return res.status(200).json({
      success: true,
      message: "Emergency contact sent successfully. Our team will reach out immediately.",
    });

  } catch (error) {
    console.error("❌ Error sending emergency email:", error);
    return res.status(500).json({
      success: false,
      error: "Failed to send emergency contact. Please call us directly.",
      details: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

/**
 * 2FA Security Token Email Template
 */
exports.verificationCodeTemplate = (code) => {
  const content = `
    <div class="email-header" style="background: linear-gradient(135deg, #f97316 0%, #ea580c 100%);">
      <h1>🔐 Security Verification</h1>
      <p>${config.company.name} Administrative Portal</p>
    </div>
    <div class="email-body">
      <h2 style="color: #111827; font-size: 20px; margin-bottom: 15px;">Confirm Your Identity</h2>
      <p style="color: #4b5563; font-size: 15px; margin-bottom: 20px;">
        A request was made to sign in to your administrative account. Please enter the verification code below to complete your authorization step.
      </p>
      
      <div style="background-color: #f8fafc; border: 1px dashed #cbd5e1; padding: 20px; text-align: center; margin: 25px 0; border-radius: 8px;">
        <span style="font-family: 'Courier New', Courier, monospace; font-size: 36px; font-weight: bold; letter-spacing: 6px; color: #1e293b;">
          ${code}
        </span>
      </div>

      <div class="divider"></div>

      <p style="font-size: 13px; color: #6b7280; line-height: 1.5;">
        ⚠️ This token expires exactly <strong>2 minutes</strong> from when it was generated. If you didn't initiate this request, change your password immediately.
      </p>
    </div>
    <div class="email-footer">
      <p><strong>${config.company.name}</strong> Security Center</p>
    </div>
  `;
  return emailWrapper(content, '#f97316');
};

/**
 * Dispatch 2FA verification token to a logging user
 * (Polymorphic wrapper: Fallbacks to sendAxiosEmail if SMTP fails or is unconfigured)
 */
exports.sendVerificationEmail = async (toEmail, code) => {
  const htmlContent = exports.verificationCodeTemplate(code);
  const subjectText = `Your Secure Login Code: ${code}`;

  // If SMTP is missing entirely, cleanly drop down to Resend REST API route
  if (!transporter) {
    console.log(`ℹ️ SMTP Transporter unconfigured. Routing verification code through Resend Axios.`);
    try {
      await exports.sendAxiosEmail({
        to: toEmail,
        subject: subjectText,
        html: htmlContent
      });
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  // If transporter structure is compiled, attempt delivery
  try {
    await transporter.sendMail({
      from: `"${config.company.name} Security" <${config.smtp.user}>`,
      to: toEmail.trim().toLowerCase(),
      subject: subjectText,
      html: htmlContent,
      text: `Your login verification code is: ${code}. This token is active for 2 minutes.`,
      headers: { 'X-Priority': '1', 'X-Mailer': 'Launit Security Module' }
    });
    console.log(`✅ 2FA Secure token successfully dispatched via SMTP to ${toEmail}`);
    return { success: true };
  } catch (error) {
    console.error('❌ SMTP 2FA dispatch failure, attempting Axios rollover fallback:', error.message);
    try {
      await exports.sendAxiosEmail({
        to: toEmail,
        subject: subjectText,
        html: htmlContent
      });
      return { success: true };
    } catch (fallbackError) {
      return { success: false, error: fallbackError.message };
    }
  }
};

// Export transporter for use in other modules if needed
exports.transporter = transporter;
exports.config = config;